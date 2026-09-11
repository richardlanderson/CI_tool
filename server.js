import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

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
    const message =
      err instanceof Anthropic.AuthenticationError
        ? "The server is not correctly authenticated with the AI service."
        : err instanceof Anthropic.RateLimitError
          ? "The AI service is rate-limited right now. Please try again shortly."
          : err instanceof Anthropic.APIError
            ? `AI service error: ${err.message}`
            : "Something went wrong contacting the AI service.";
    res.status(502).json({ error: message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SIC Code Finder running at http://localhost:${PORT}`);
});
