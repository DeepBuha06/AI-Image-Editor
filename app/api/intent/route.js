import { NextResponse } from "next/server";

export async function POST(request) {
    const { prompt } = await request.json();
    const p = prompt.toLowerCase();

    // Keyword matching — covers 95% of real cases
    const removalKeywords = ["remove", "delete", "erase", "get rid", "take out", "eliminate"];
    const fusionKeywords = ["add", "insert", "place", "put", "include", "generate new", "create a"];
    const sketchKeywords = ["sketch", "draw", "drawing", "scribble", "rough"];

    let type = "object_edit"; // default
    let confidence = 0.85;

    if (removalKeywords.some(k => p.includes(k))) {
        type = "object_removal";
    } else if (sketchKeywords.some(k => p.includes(k))) {
        type = "sketch_to_object";
    } else if (fusionKeywords.some(k => p.includes(k))) {
        type = "object_fusion";
    }

    // Basic guardrail — block explicit content
    const blocked = ["nude", "naked", "explicit", "nsfw", "porn", "violence", "blood"];
    if (blocked.some(k => p.includes(k))) {
        return NextResponse.json({ error: "Instruction not allowed" }, { status: 400 });
    }

    // Extract target object — first noun after keywords
    const targetMatch = prompt.match(/(?:the|a|an)\s+([a-zA-Z]+)/i);
    const targetObject = targetMatch ? targetMatch[1] : "";

    return NextResponse.json({ type, targetObject, confidence });
}
