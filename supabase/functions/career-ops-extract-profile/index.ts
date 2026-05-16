/**
 * career-ops-extract-profile
 *
 * Supabase Edge Function — accepts a PDF or plain-text resume upload,
 * extracts a structured Career Ops profile JSON via the LLM, and saves
 * it to career_ops_user_profiles.
 *
 * POST /functions/v1/career-ops-extract-profile
 * Content-Type: multipart/form-data  (field: "resume", file: PDF or TXT)
 *   OR
 * Content-Type: application/json     { "text": "<resume plain text>" }
 *
 * Returns: { profileId, profile }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const EXTRACT_SYSTEM = `You are a resume parser. Extract a structured Career Ops profile from the provided resume text.
Return ONLY valid JSON — no markdown fences, no commentary.

Schema:
{
  "role": "current or target job title",
  "summary": "1-2 sentence professional summary",
  "skills": ["skill1", "skill2", ...],
  "experience": [
    { "company": "...", "title": "...", "duration": "...", "highlights": ["..."] }
  ],
  "education": [{ "institution": "...", "degree": "...", "year": "..." }],
  "languages": ["English", "Chinese", ...],
  "preferences": {
    "targetRoles": ["Frontend Engineer", "UI Engineer"],
    "targetLocations": ["Taipei", "Remote"],
    "keywords": ["React", "TypeScript", "accessibility"]
  }
}`;

async function extractWithLlm(text: string, apiKey: string): Promise<Record<string, unknown>> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 2048,
      temperature: 0.1,
      system: EXTRACT_SYSTEM,
      messages: [{ role: "user", content: `Resume:\n\n${text.slice(0, 12000)}` }],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  const content = data.content?.[0]?.text || "{}";
  return JSON.parse(content);
}

async function extractTextFromPdf(bytes: Uint8Array): Promise<string> {
  // Edge Functions can't run native PDF parsers, so we use a simple
  // heuristic: strip binary noise and extract readable ASCII runs.
  // For production, route through a PDF-to-text microservice or use
  // Anthropic's vision API with the PDF as an image.
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const raw = decoder.decode(bytes);
  // Extract text between BT...ET PDF operators (basic text extraction)
  const chunks: string[] = [];
  const btEtRegex = /BT([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(raw)) !== null) {
    const block = match[1];
    // Extract string literals from parentheses
    const strRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
    let strMatch;
    while ((strMatch = strRegex.exec(block)) !== null) {
      const s = strMatch[1].replace(/\\n/g, "\n").replace(/\\r/g, " ").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
      if (s.trim().length > 1) chunks.push(s);
    }
  }
  if (chunks.length > 20) return chunks.join(" ");
  // Fallback: just grab readable ASCII runs >= 4 chars
  const readable = raw.match(/[\x20-\x7E]{4,}/g) || [];
  return readable.join(" ");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  // Authenticate user
  const authHeader = req.headers.get("Authorization");
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authHeader ?? "" } },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  let resumeText = "";
  const contentType = req.headers.get("content-type") || "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("resume") as File | null;
      if (!file) {
        return new Response(JSON.stringify({ error: "No 'resume' field in form data" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (file.type === "application/pdf" || file.name?.endsWith(".pdf")) {
        resumeText = await extractTextFromPdf(bytes);
      } else {
        resumeText = new TextDecoder().decode(bytes);
      }
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      resumeText = String(body.text || "");
    } else {
      resumeText = await req.text();
    }

    if (!resumeText.trim()) {
      return new Response(JSON.stringify({ error: "Could not extract text from resume" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    }

    // Extract structured profile
    let profile: Record<string, unknown> = {};
    if (anthropicKey) {
      profile = await extractWithLlm(resumeText, anthropicKey);
    } else {
      // Fallback: minimal heuristic extraction
      profile = {
        role: "",
        summary: resumeText.slice(0, 300),
        skills: [],
        experience: [],
        education: [],
        languages: [],
        preferences: { targetRoles: [], targetLocations: [], keywords: [] },
      };
    }

    // Deactivate previous active profiles
    await supabase
      .from("career_ops_user_profiles")
      .update({ is_active: false })
      .eq("user_id", user.id)
      .eq("is_active", true);

    // Save new profile
    const { data: saved, error: insertError } = await supabase
      .from("career_ops_user_profiles")
      .insert({
        user_id: user.id,
        source: contentType.includes("multipart") ? "pdf_upload" : "manual",
        profile_json: profile,
        raw_text: resumeText.slice(0, 50000),
        is_active: true,
      })
      .select("id")
      .single();

    if (insertError) throw new Error(insertError.message);

    return new Response(JSON.stringify({ profileId: saved.id, profile }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
