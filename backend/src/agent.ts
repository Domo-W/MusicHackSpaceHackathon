import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "./config.js";

const client = new Anthropic({ apiKey: CONFIG.anthropicApiKey });

export interface SongSeed {
  name: string; // the selected participant's name
  answer: string; // their answer to the performer's question
  genre: string; // the winning genre from the tug battle
}

export interface SongPrompt {
  title: string;
  lyrics: string; // [Verse]/[Chorus]/... with a name shout-out
  style: string; // genre + fixed BPM + production descriptors (Suno `style`)
}

// JSON-schema-constrained output (supported on opus-4-8 / sonnet-4-6 / haiku-4-5).
// Note: json_schema does not support minLength/maxLength — section count is steered
// via the prompt, not the schema.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "A short, punchy song title." },
    lyrics: {
      type: "string",
      description:
        "Full lyrics with [Verse]/[Chorus]/[Bridge] section tags. Must shout out the person's name and build on their answer.",
    },
    style: {
      type: "string",
      description: "Suno style string: genre + BPM + production descriptors.",
    },
  },
  required: ["title", "lyrics", "style"],
} as const;

const FORMAT_EXAMPLE = `[Intro]
Melissa

[Chorus]
I'm drunk and outside
Hey
Hey
Hey
I'm drunk and outside

[Verse 1]
Good vibe, good energy
We all are outside (outside)
Good vibe, good energy
We outside tonight

[Chorus]
Melissa
I'm drunk and outside
Hey

[Verse 2]
Turn up, turn up the place (Hey)
Everybody matching replays
Turn up turn up the bass
We outside 'til morning day
Melissa, come toss me the rum
Melissa, we outside for fun
Melissa, ah, ah, ah

[Chorus]
I'm drunk and outside
Hey
Oh
Hey
Melissa, come toss me the rum
Melissa, we outside for fun
Melissa, ah, ah, ah
I'm jumping outside

[Outro]
Hey, oh
Hey, Melissa`;

function systemPrompt(): string {
  return [
    "You are the live lyricist for 'Between Sets', a party where the crowd's answers become AI songs in real time.",
    "Turn ONE person's name + their 'I want to…' intent + a winning genre into a chantable, crowd-igniting party song.",
    "",
    "FORMAT — follow this structure and style closely (this is the target):",
    FORMAT_EXAMPLE,
    "",
    "Rules:",
    `- THE PERSON'S NAME IS MANDATORY and central: it IS the [Intro], it lands in the [Chorus], and it is chanted REPEATEDLY inside the verses as direct call-outs (e.g. "<Name>, come toss me the rum / <Name>, we outside for fun / <Name>, ah ah ah"). Never omit, abbreviate, or anonymize it — even when transforming an unsafe intent.`,
    "- Build the [Chorus] as a SHORT, super-repetitive hook drawn straight from their intent (like \"I'm drunk and outside\"). Repeat it; keep words simple and shoutable.",
    "- Pepper in crowd ad-libs and call-and-response: \"Hey\", \"Oh\", \"(outside)\", \"ah ah ah\".",
    "- Use these exact section tags: [Intro], [Chorus], [Verse 1], [Verse 2], [Outro] (repeat [Chorus] between verses). Aim for ~6–8 sections so the song runs long enough.",
    `- The 'style' field MUST start with the genre, then include "${CONFIG.fixedBpm} BPM, 4/4, steady danceable tempo" plus a few production descriptors, so consecutive songs beat-match for crossfading.`,
    "- Keep it crowd-friendly: no slurs, hate, explicit sexual content, or targeted insults. If an intent is unsafe, transform it into something fun and inclusive (still keep the name).",
    "Return ONLY the structured fields (title, lyrics, style).",
  ].join("\n");
}

function userPrompt(seed: SongSeed): string {
  return [
    `Name: ${seed.name}`,
    `Their answer: ${seed.answer}`,
    `Winning genre: ${seed.genre}`,
    `Target sections: ${CONFIG.targetSections}`,
  ].join("\n");
}

/** Case-insensitive check that the name is sung in the lyrics. */
function nameAppears(lyrics: string, name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true; // no name given → nothing to enforce
  return lyrics.toLowerCase().includes(n);
}

/** Deterministic fallback if the LLM call fails or is too slow. */
export function templatePrompt(seed: SongSeed): SongPrompt {
  const name = seed.name.trim() || "you";
  const chorus = `[Chorus]\n${name}, this one's for you\n${seed.answer}\nTurn it up, we're breaking through`;
  const sections = [
    `[Verse]\nSomebody said it, ${name} in the crowd`,
    `"${seed.answer}" — say it loud`,
    chorus,
    `[Verse]\nLights are flashing, the bass is alive\n${name}, this is your time to thrive`,
    chorus,
    `[Bridge]\nEvery voice, every hand in the air`,
    chorus,
  ];
  return {
    title: `${name}'s ${seed.genre} Anthem`,
    lyrics: sections.join("\n"),
    style: `${seed.genre}, ${CONFIG.fixedBpm} BPM, 4/4, steady danceable tempo, punchy drums, bright`,
  };
}

/** Craft a Suno prompt from the seed. Falls back to a template on any failure. */
export async function craftSongPrompt(seed: SongSeed): Promise<SongPrompt> {
  try {
    const res = await client.messages.create({
      model: CONFIG.agentModel,
      max_tokens: 2048,
      system: systemPrompt(),
      // output_config.format constrains the response to our JSON schema.
      output_config: {
        format: { type: "json_schema", schema: SCHEMA },
        effort: "low", // short creative task; keep it snappy
      },
      messages: [{ role: "user", content: userPrompt(seed) }],
    } as any);

    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("agent: no text block");
    const parsed = JSON.parse(text.text) as SongPrompt;
    if (!parsed.lyrics || !parsed.style) throw new Error("agent: incomplete output");
    // Hard guarantee: the participant's name MUST appear in the lyrics. If the
    // model somehow dropped it, fall back to the template (which always sings it).
    if (!nameAppears(parsed.lyrics, seed.name)) {
      throw new Error(`agent: name "${seed.name}" missing from lyrics`);
    }
    return parsed;
  } catch (err) {
    console.error("agent: falling back to template —", (err as Error).message);
    return templatePrompt(seed);
  }
}
