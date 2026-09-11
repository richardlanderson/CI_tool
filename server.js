import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { sharedRateLimiter, searchSicCode, fetchCompanyDetails } from "./lib/companiesHouse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new Anthropic();

const SicCodeSchema = z.object({
  code: z.string(),
  description: z.string(),
});

const SicSectionSchema = z.object({
  section_letter: z.string(),
  section_name: z.string(),
  codes: z.array(SicCodeSchema),
});

const SicResultSchema = z.object({
  sections: z.array(SicSectionSchema),
});

const SYSTEM_PROMPT = `You are given a description of a type of business. Return the UK Companies House
condensed SIC (Standard Industrial Classification) codes most relevant to that
business type.

Only include SIC codes from the official Companies House condensed SIC code list.
Only include sections that have at least one relevant code. Order sections and
codes by relevance, most relevant first.`;

const RELATED_SYSTEM_PROMPT = `You are given a UK Companies House condensed SIC (Standard Industrial
Classification) code. Suggest other SIC codes from the official Companies House
condensed SIC code list that are closely related to it — for example, adjacent
activities in the same industry, complementary business activities, or codes
commonly used alongside it.

Only include SIC codes from the official Companies House condensed SIC code list.
Do not include the code that was given as input — only the related codes. Only
include sections that have at least one relevant code. Order sections and codes
by relevance, most relevant first.`;

function mapAnthropicError(err) {
  return err instanceof Anthropic.AuthenticationError
    ? "The server is not correctly authenticated with the AI service."
    : err instanceof Anthropic.RateLimitError
      ? "The AI service is rate-limited right now. Please try again shortly."
      : err instanceof Anthropic.APIError
        ? `AI service error: ${err.message}`
        : "Something went wrong contacting the AI service.";
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/sic-codes", async (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (!query) {
    return res.status(400).json({ error: "A business description is required." });
  }

  try {
    const response = await client.beta.messages.parse({
      model: "claude-opus-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Can you provide a list of the relevant SIC codes that are relevant to this type of business: ${query}`,
        },
      ],
      output_format: betaZodOutputFormat(SicResultSchema),
    });

    if (!response.parsed_output) {
      return res
        .status(502)
        .json({ error: "The AI response could not be understood. Please try again." });
    }

    res.json(response.parsed_output);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: mapAnthropicError(err) });
  }
});

app.post("/api/related-sic-codes", async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";

  if (!code) {
    return res.status(400).json({ error: "A SIC code is required." });
  }

  try {
    const response = await client.beta.messages.parse({
      model: "claude-opus-5",
      max_tokens: 4096,
      system: RELATED_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Can you suggest a list of all the SIC codes that are related to ${code}${description ? ` (${description})` : ""}`,
        },
      ],
      output_format: betaZodOutputFormat(SicResultSchema),
    });

    if (!response.parsed_output) {
      return res
        .status(502)
        .json({ error: "The AI response could not be understood. Please try again." });
    }

    res.json(response.parsed_output);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: mapAnthropicError(err) });
  }
});

app.post("/api/find-companies", async (req, res) => {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  const sicCodes = Array.isArray(req.body?.sicCodes)
    ? req.body.sicCodes.filter((c) => c && typeof c.code === "string" && c.code.trim())
    : [];

  if (!apiKey) {
    return res
      .status(400)
      .json({ error: "Companies House API key not configured — see setup instructions." });
  }
  if (sicCodes.length === 0) {
    return res.status(400).json({ error: "At least one SIC code is required." });
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  const writeEvent = (event) => res.write(`${JSON.stringify(event)}\n`);

  const combined = new Map();
  const breakdown = [];
  const failures = [];

  for (let i = 0; i < sicCodes.length; i++) {
    const { code, description } = sicCodes[i];
    writeEvent({ type: "progress", currentIndex: i + 1, total: sicCodes.length, code, description });

    try {
      const { companies, totalHits } = await searchSicCode({
        apiKey,
        sicCode: code,
        rateLimiter: sharedRateLimiter,
      });

      for (const company of companies) {
        const existing = combined.get(company.companyNumber);
        if (existing) {
          existing.matchedSicCodes.add(code);
        } else {
          combined.set(company.companyNumber, { ...company, matchedSicCodes: new Set([code]) });
        }
      }

      breakdown.push({ code, description, count: companies.length, totalHits });
      writeEvent({ type: "code-complete", code, description, count: companies.length, totalHits });
    } catch (err) {
      console.error(`SIC code ${code} failed:`, err);
      failures.push({ code, description, message: err.message });
      writeEvent({ type: "code-error", code, description, message: err.message });
    }
  }

  const companies = [...combined.values()].map((c) => ({ ...c, matchedSicCodes: [...c.matchedSicCodes] }));
  writeEvent({ type: "done", companies, breakdown, failures });
  res.end();
});

app.post("/api/find-companies/retry-code", async (req, res) => {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description : undefined;

  if (!apiKey) {
    return res
      .status(400)
      .json({ error: "Companies House API key not configured — see setup instructions." });
  }
  if (!code) {
    return res.status(400).json({ error: "A SIC code is required." });
  }

  try {
    const { companies, totalHits } = await searchSicCode({
      apiKey,
      sicCode: code,
      rateLimiter: sharedRateLimiter,
    });
    res.json({
      code,
      description,
      totalHits,
      companies: companies.map((c) => ({ ...c, matchedSicCodes: [code] })),
    });
  } catch (err) {
    console.error(`Retry for SIC code ${code} failed:`, err);
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/companies/:companyNumber/details", async (req, res) => {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  const companyNumber = req.params.companyNumber;

  if (!apiKey) {
    return res
      .status(400)
      .json({ error: "Companies House API key not configured — see setup instructions." });
  }
  if (!/^[A-Za-z0-9]+$/.test(companyNumber)) {
    return res.status(400).json({ error: "Invalid company number." });
  }

  try {
    const details = await fetchCompanyDetails({
      apiKey,
      companyNumber,
      rateLimiter: sharedRateLimiter,
    });
    res.json(details);
  } catch (err) {
    console.error(`Officer/PSC lookup for ${companyNumber} failed:`, err);
    res.status(502).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SIC Code Finder running at http://localhost:${PORT}`);
});
