/**
 * career-ops-extract-profile
 *
 * Supabase Edge Function — accepts an already-extracted Career Ops
 * profile JSON or a plain-text/PDF resume upload, then saves it to
 * career_ops_user_profiles.
 *
 * BYOK note: LLM extraction is done in the browser with the user's
 * own API key. This function never reads ANTHROPIC_API_KEY and never
 * receives or stores a user model key.
 *
 * POST /functions/v1/career-ops-extract-profile
 * Content-Type: multipart/form-data  (field: "resume", file: PDF or TXT)
 *   OR
 * Content-Type: application/json     { "text": "<resume plain text>" }
 *
 * Returns: { profileId, profile }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeProfile(input: unknown, resumeText: string): Record<string, unknown> {
  const source = objectRecord(input);
  const preferences = objectRecord(source.preferences);
  return {
    role: String(source.role || source.title || ""),
    summary: String(source.summary || resumeText.slice(0, 300)),
    skills: stringArray(source.skills),
    experience: Array.isArray(source.experience) ? source.experience : [],
    education: Array.isArray(source.education) ? source.education : [],
    languages: stringArray(source.languages),
    preferences: {
      targetRoles: stringArray(preferences.targetRoles || preferences.target_roles),
      targetLocations: stringArray(preferences.targetLocations || preferences.target_locations),
      keywords: stringArray(preferences.keywords),
    },
  };
}

function heuristicProfile(resumeText: string): Record<string, unknown> {
  const skillTerms = [
    "JavaScript", "TypeScript", "React", "Vue", "Next.js", "Node.js", "Python", "SQL",
    "AWS", "Docker", "Kubernetes", "Figma", "Analytics", "SEO", "CRM", "Product",
  ];
  const lower = resumeText.toLowerCase();
  return {
    role: "",
    summary: resumeText.slice(0, 300),
    skills: skillTerms.filter((skill) => lower.includes(skill.toLowerCase())),
    experience: [],
    education: [],
    languages: [],
    preferences: { targetRoles: [], targetLocations: [], keywords: [] },
  };
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
  let providedProfile: Record<string, unknown> | null = null;
  let source = "manual";
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
        source = "pdf_upload";
      } else {
        resumeText = new TextDecoder().decode(bytes);
      }
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      resumeText = String(body.text || body.rawText || "");
      if (body.profile && typeof body.profile === "object") {
        providedProfile = normalizeProfile(body.profile, resumeText);
      }
      source = String(body.source || "manual").slice(0, 40);
    } else {
      resumeText = await req.text();
    }

    if (!resumeText.trim() && !providedProfile) {
      return new Response(JSON.stringify({ error: "Missing resume text or extracted profile" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    }

    const profile = providedProfile || heuristicProfile(resumeText);

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
        source,
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
