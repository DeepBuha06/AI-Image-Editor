import { NextResponse } from "next/server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

function classifyIntentHeuristic(prompt) {
    const lower = prompt.toLowerCase();

    if (/remove|delete|erase|eliminate|get rid of|clean up/.test(lower)) {
        return { intent: "removal", confidence: 0.7, reason: "Detected removal action keywords" };
    }

    if (/add|insert|place|put|include|generate|create/.test(lower)) {
        return { intent: "fusion", confidence: 0.7, reason: "Detected object insertion keywords" };
    }

    return { intent: "edit", confidence: 0.55, reason: "Defaulted to general edit/inpaint" };
}

function safeParseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch {
            return null;
        }
    }
}

async function classifyIntentWithClaude(prompt, modeHint) {
    if (!ANTHROPIC_API_KEY) {
        return null;
    }

    const system = [
        "You are an intent classifier for an AI photo editor.",
        "Return ONLY JSON with this exact schema:",
        '{"intent":"removal|fusion|edit","confidence":0-1,"reason":"short"}',
        "Rules:",
        "- removal: user wants object erased/removed.",
        "- fusion: user wants to add/insert/place new object in scene.",
        "- edit: recolor/replace/transform existing region.",
    ].join("\n");

    const user = `Prompt: ${prompt}\nMode hint: ${modeHint}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: ANTHROPIC_MODEL,
            max_tokens: 120,
            system,
            messages: [{ role: "user", content: user }],
        }),
    });

    if (!response.ok) {
        return null;
    }

    const data = await response.json();
    const text = data?.content?.find((c) => c.type === "text")?.text;
    if (!text) return null;

    const parsed = safeParseJson(text);
    if (!parsed) return null;

    if (!["removal", "fusion", "edit"].includes(parsed.intent)) return null;

    return {
        intent: parsed.intent,
        confidence: Number(parsed.confidence) || 0.6,
        reason: parsed.reason || "Classified by Claude",
    };
}

export async function POST(request) {
    try {
        const { prompt, modeHint = "auto" } = await request.json();

        if (!prompt || typeof prompt !== "string") {
            return NextResponse.json({ error: "prompt is required" }, { status: 400 });
        }

        const claudeResult = await classifyIntentWithClaude(prompt, modeHint);
        const result = claudeResult || classifyIntentHeuristic(prompt);

        const route =
            result.intent === "removal"
                ? "/api/removal"
                : result.intent === "fusion"
                    ? "/api/fusion"
                    : "/api/comfyui";

        return NextResponse.json({
            success: true,
            ...result,
            route,
            provider: claudeResult ? "claude" : "heuristic",
        });
    } catch (error) {
        return NextResponse.json(
            {
                success: true,
                ...classifyIntentHeuristic(""),
                route: "/api/comfyui",
                provider: "heuristic_fallback",
                warning: error.message || "Intent routing fallback used",
            },
            { status: 200 },
        );
    }
}
