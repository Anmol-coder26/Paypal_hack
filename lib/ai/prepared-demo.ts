import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { AIStructuredFindings, EvidenceRecord, TaskBundle } from "../types";

export type PreparedScenarioCategory = "painting" | "tile" | "wall";

export interface PreparedDemoScenario {
  id: string;
  label: string;
  category: PreparedScenarioCategory;
  beforeFile: string;
  afterFile: string;
  overall_assessment: "appears_satisfied" | "concerns_identified";
  suggested_outcome: "accept" | "review_concerns";
  summary: string;
  visible_observations: string[];
  criterionStatusFn: (criterion: string) => {
    status: "satisfied" | "unmet" | "unverifiable";
    observation: string;
  };
  limitations_and_uncertainty: string[];
  recommended_next_steps: string[];
}

export const PREPARED_DEMO_SCENARIOS: PreparedDemoScenario[] = [
  {
    id: "painting_satisfactory",
    label: "Painting — satisfactory visible finish",
    category: "painting",
    beforeFile: "painting-before.png",
    afterFile: "painting-after.png",
    overall_assessment: "appears_satisfied",
    suggested_outcome: "accept",
    summary:
      "Prepared demo inspection: dark scuff marks beside the window visible in BEFORE #1 are covered cleanly with uniform matte color and sharp trim edges in AFTER #1.",
    visible_observations: [
      "BEFORE photo shows dark scuff streaks on the wall to the right of the window frame.",
      "AFTER photo shows uniform color blending across the repaired area with no visible lap marks or blotches.",
      "Trim cut-in edges along the window frame appear clean without paint overlap.",
    ],
    criterionStatusFn: (crit) => {
      const l = crit.toLowerCase();
      if (l.includes("thickness") || l.includes("primer") || l.includes("voc")) {
        return {
          status: "unverifiable",
          observation: "Sample photo view cannot measure dry-film coat thickness or primer chemistry.",
        };
      }
      if (l.includes("edge") || l.includes("trim") || l.includes("clean")) {
        return {
          status: "satisfied",
          observation: "Prepared sample comparison confirms crisp lines along the window frame.",
        };
      }
      if (l.includes("patch") || l.includes("scuff") || l.includes("unpainted")) {
        return {
          status: "satisfied",
          observation: "Prior wall scuffs are fully covered with no missed patches visible.",
        };
      }
      return {
        status: "satisfied",
        observation: "Wall finish appears even across the repaired section relative to adjacent paint.",
      };
    },
    limitations_and_uncertainty: [
      "Prepared sample comparison reflects supplied demonstration photos only.",
      "2D photographs cannot confirm coat count, paint adhesion, or subtle color shift under night lighting.",
    ],
    recommended_next_steps: [
      "Homeowner may proceed with Accept & Capture once satisfied with the comparison.",
    ],
  },
  {
    id: "painting_uneven",
    label: "Painting — uneven coverage",
    category: "painting",
    beforeFile: "painting-before.png",
    afterFile: "painting-after-uneven.png",
    overall_assessment: "concerns_identified",
    suggested_outcome: "review_concerns",
    summary:
      "Prepared demo inspection: prior scuffs are painted over, but a distinct lighter rectangular touch-up patch and a missed darker strip beside the window trim remain visible.",
    visible_observations: [
      "BEFORE photo documents dark scuff marks beside the window.",
      "AFTER photo shows a visible lighter rectangular paint patch in the center wall area that does not blend evenly.",
      "A vertical darker uncoated strip remains visible immediately adjacent to the right window casing.",
    ],
    criterionStatusFn: (crit) => {
      const l = crit.toLowerCase();
      if (l.includes("edge") || l.includes("trim")) {
        return {
          status: "unmet",
          observation: "Visible concern: missed dark strip immediately beside the right window trim.",
        };
      }
      if (l.includes("uniform") || l.includes("patch") || l.includes("coverage") || l.includes("blend")) {
        return {
          status: "unmet",
          observation: "Visible concern: lighter rectangular touch-up section contrasts with surrounding wall color.",
        };
      }
      return {
        status: "unmet",
        observation: "Prepared sample inspection flagged uneven paint finish in the after image.",
      };
    },
    limitations_and_uncertainty: [
      "Prepared sample comparison reflects supplied demonstration photos only.",
      "Photographs cannot establish whether a second finish coat was applied before curing.",
    ],
    recommended_next_steps: [
      "Request Corrections for feather blending and trim edge touch-up, or Reject & Void if unsatisfactory.",
    ],
  },
  {
    id: "tile_aligned",
    label: "Tile repair — aligned replacement tile",
    category: "tile",
    beforeFile: "tile-before.png",
    afterFile: "tile-after-aligned.png",
    overall_assessment: "appears_satisfied",
    suggested_outcome: "accept",
    summary:
      "Prepared demo inspection: cracked backsplash tile (row 3, column 2) is replaced cleanly in AFTER #1, aligned evenly with neighboring courses and consistent grout lines.",
    visible_observations: [
      "BEFORE photo shows a jagged diagonal crack across the row 3, column 2 tile.",
      "AFTER photo shows an intact replacement tile aligned horizontally and vertically with neighboring tiles.",
      "Surrounding perimeter grout joints appear even and continuously filled without open voids.",
    ],
    criterionStatusFn: (crit) => {
      const l = crit.toLowerCase();
      if (l.includes("mortar") || l.includes("membrane") || l.includes("waterproof")) {
        return {
          status: "unverifiable",
          observation: "Photos cannot inspect subsurface thin-set mortar coverage or membrane integrity.",
        };
      }
      return {
        status: "satisfied",
        observation: "Replacement tile appears intact, level in course alignment, and evenly grouted.",
      };
    },
    limitations_and_uncertainty: [
      "Prepared sample comparison reflects supplied demonstration photos only.",
      "Surface photos cannot verify thin-set bond strength or waterproofing behind the tile.",
    ],
    recommended_next_steps: [
      "Homeowner may proceed with Accept & Capture if satisfied with finish.",
    ],
  },
  {
    id: "tile_gaps_misaligned",
    label: "Tile repair — visible gaps or misalignment",
    category: "tile",
    beforeFile: "tile-before.png",
    afterFile: "tile-after-issue.png",
    overall_assessment: "concerns_identified",
    suggested_outcome: "review_concerns",
    summary:
      "Prepared demo inspection: the cracked tile was replaced, but the replacement tile is visibly tilted with wide dark unfilled grout gaps along the top and right perimeter joints.",
    visible_observations: [
      "BEFORE photo shows a cracked tile at row 3, column 2.",
      "AFTER photo confirms the cracked tile face is gone, but the replacement tile sits noticeably tilted relative to adjacent horizontal lines.",
      "Open dark gaps remain visible along the top and right grout seams where grout is missing.",
    ],
    criterionStatusFn: (crit) => {
      const l = crit.toLowerCase();
      if (l.includes("replace") || l.includes("damaged") || l.includes("crack")) {
        return {
          status: "satisfied",
          observation: "Cracked tile face from BEFORE photo has been replaced.",
        };
      }
      if (l.includes("align") || l.includes("tilt") || l.includes("straight")) {
        return {
          status: "unmet",
          observation: "Visible concern: replacement tile sits slightly rotated/offset relative to adjacent courses.",
        };
      }
      if (l.includes("gap") || l.includes("grout") || l.includes("finish") || l.includes("complete")) {
        return {
          status: "unmet",
          observation: "Visible concern: dark unfilled grout gaps appear along the top and right tile edges.",
        };
      }
      return {
        status: "unmet",
        observation: "Alignment offset and incomplete perimeter grouting remain visible.",
      };
    },
    limitations_and_uncertainty: [
      "Prepared sample comparison reflects supplied demonstration photos only.",
      "2D photos cannot verify mortar coverage behind the replacement tile.",
    ],
    recommended_next_steps: [
      "Request Corrections to reset tile alignment and fill grout joints, or Reject & Void Hold.",
    ],
  },
  {
    id: "wall_completed",
    label: "Wall repair — completed patch",
    category: "wall",
    beforeFile: "wall-before.png",
    afterFile: "wall-after.png",
    overall_assessment: "appears_satisfied",
    suggested_outcome: "accept",
    summary:
      "Prepared demo inspection: the drywall hole beside the light switch in BEFORE #1 is cleanly closed, feathered flush, and uniform in AFTER #1.",
    visible_observations: [
      "BEFORE photo shows an open drywall hole to the right of the wall light switch landmark.",
      "AFTER photo shows the wall opening fully closed and smoothly feathered to match surrounding drywall.",
      "No raised tape seams, cracks, or exposed compound ridges are visible around the patched region.",
    ],
    criterionStatusFn: (crit) => {
      const l = crit.toLowerCase();
      if (l.includes("stud") || l.includes("moisture") || l.includes("behind")) {
        return {
          status: "unverifiable",
          observation: "Surface photography cannot inspect framing backing or cavity moisture behind drywall.",
        };
      }
      return {
        status: "satisfied",
        observation: "Wall opening is closed cleanly and surface blends smoothly beside the light switch.",
      };
    },
    limitations_and_uncertainty: [
      "Prepared sample comparison reflects supplied demonstration photos only.",
      "Frontal lighting may soften subtle texture differences; internal wall backing cannot be verified visually.",
    ],
    recommended_next_steps: [
      "Homeowner may proceed with Accept & Capture.",
    ],
  },
  {
    id: "wall_concern",
    label: "Wall repair — visible remaining concern",
    category: "wall",
    beforeFile: "wall-before.png",
    afterFile: "wall-after-issue.png",
    overall_assessment: "concerns_identified",
    suggested_outcome: "review_concerns",
    summary:
      "Prepared demo inspection: the hole beside the light switch is closed, but a raised rectangular patch seam outline and dark perimeter ridge remain clearly visible.",
    visible_observations: [
      "BEFORE photo documents an open drywall cavity beside the light switch.",
      "AFTER photo shows the opening filled, but a distinct rectangular joint ridge and unfeathered dark seam surround the patch.",
    ],
    criterionStatusFn: (crit) => {
      const l = crit.toLowerCase();
      if (l.includes("close") || l.includes("filled") || l.includes("hole")) {
        return {
          status: "satisfied",
          observation: "The open cavity from BEFORE is physically covered.",
        };
      }
      return {
        status: "unmet",
        observation: "Visible concern: rectangular patch seam ridge and edge outline remain unfeathered.",
      };
    },
    limitations_and_uncertainty: [
      "Prepared sample comparison reflects supplied demonstration photos only.",
      "Direct photography cannot measure exact ridge height in millimeters or interior backing.",
    ],
    recommended_next_steps: [
      "Request Corrections for skim-coating and feather sanding before capture, or Reject & Void.",
    ],
  },
];

let cachedDemoSignatures: Map<string, string> | null = null;

/**
 * Downsamples any PNG/JPG/WebP into normalized 160x120 RGB raw pixels and hashes it.
 * Survives sharp EXIF-stripping / PNG re-compression while strictly distinguishing actual visual content.
 */
export async function computeNormalizedImageSignature(bytes: Buffer): Promise<string> {
  const raw = await sharp(bytes)
    .resize(160, 120, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function getDemoKitSignatures(): Promise<Map<string, string>> {
  if (cachedDemoSignatures) return cachedDemoSignatures;
  const map = new Map<string, string>();
  const kitDir = path.resolve(process.cwd(), "public", "demo-kit");
  const files = new Set<string>();
  for (const s of PREPARED_DEMO_SCENARIOS) {
    files.add(s.beforeFile);
    files.add(s.afterFile);
  }
  for (const file of files) {
    try {
      const buf = await fs.readFile(path.join(kitDir, file));
      const sig = await computeNormalizedImageSignature(buf);
      map.set(file, sig);
    } catch {
      // File may be absent in isolated temp tests; handled gracefully
    }
  }
  cachedDemoSignatures = map;
  return map;
}

export function clearPreparedDemoSignatureCache(): void {
  cachedDemoSignatures = null;
}

export function detectTaskDomain(task: Pick<TaskBundle, "title" | "description">): PreparedScenarioCategory | null {
  const hay = `${task.title} ${task.description}`.toLowerCase();
  if (/(tile|grout|backsplash|ceramic|porcelain)/.test(hay)) return "tile";
  if (/(paint|repaint|scuff|coat|primer|trim)/.test(hay)) return "painting";
  if (/(wall|drywall|patch|hole|plaster|spackle|dent)/.test(hay)) return "wall";
  return null;
}

export type PreparedMatchResult =
  | {
      matched: true;
      scenario: PreparedDemoScenario;
      findings: AIStructuredFindings;
      recommendation: "accept" | "review_concerns";
    }
  | {
      matched: false;
      reason: "category_mismatch" | "unmatched_arbitrary_images";
      message: string;
    };

export async function matchPreparedDemoScenario(opts: {
  task: Pick<TaskBundle, "title" | "description" | "acceptance_criteria">;
  beforeImages: Array<{ record: EvidenceRecord; bytes: Buffer }>;
  afterImages: Array<{ record: EvidenceRecord; bytes: Buffer }>;
  evidenceIds: string[];
  imageHashes: string[];
  inputFingerprint: string;
  qualityWarnings: string[];
}): Promise<PreparedMatchResult> {
  const sigMap = await getDemoKitSignatures();
  const [beforeSigs, afterSigs] = await Promise.all([
    Promise.all(opts.beforeImages.map((b) => computeNormalizedImageSignature(b.bytes))),
    Promise.all(opts.afterImages.map((a) => computeNormalizedImageSignature(a.bytes))),
  ]);

  let matchedScenario: PreparedDemoScenario | null = null;
  for (const scenario of PREPARED_DEMO_SCENARIOS) {
    const bExpected = sigMap.get(scenario.beforeFile);
    const aExpected = sigMap.get(scenario.afterFile);
    if (!bExpected || !aExpected) continue;
    if (beforeSigs.includes(bExpected) && afterSigs.includes(aExpected)) {
      matchedScenario = scenario;
      break;
    }
  }

  if (!matchedScenario) {
    return {
      matched: false,
      reason: "unmatched_arbitrary_images",
      message:
        "Uploaded photographs do not match any prepared sample photo pair. Complete homeowner Guided Review below or upload matching demo sample photos.",
    };
  }

  const taskDomain = detectTaskDomain(opts.task);
  if (taskDomain && taskDomain !== matchedScenario.category) {
    return {
      matched: false,
      reason: "category_mismatch",
      message: `Submitted photographs match the "${matchedScenario.label}" sample case, which does not fit this ${taskDomain} task. Prepared findings cannot be attached to mismatched evidence; complete Guided Review below.`,
    };
  }

  const criteriaChecks = opts.task.acceptance_criteria.map((criterion) => {
    const res = matchedScenario.criterionStatusFn(criterion);
    return {
      criterion,
      status: res.status,
      observation: res.observation,
    };
  });

  const satisfied = criteriaChecks.filter((c) => c.status === "satisfied").map((c) => c.criterion);
  const unmet = criteriaChecks.filter((c) => c.status === "unmet").map((c) => c.criterion);
  const unverifiable = criteriaChecks
    .filter((c) => c.status === "unverifiable")
    .map((c) => c.criterion);

  const findings: AIStructuredFindings = {
    overall_assessment: matchedScenario.overall_assessment,
    summary: matchedScenario.summary,
    views_comparable: "yes",
    visible_observations: matchedScenario.visible_observations,
    criteria_checks: criteriaChecks,
    criteria_satisfied: satisfied,
    criteria_unmet: unmet,
    criteria_unverifiable: unverifiable,
    missing_evidence: [],
    recommended_next_steps: matchedScenario.recommended_next_steps,
    suggested_outcome: matchedScenario.suggested_outcome,
    limitations_and_uncertainty: matchedScenario.limitations_and_uncertainty,
    is_genuine_ai: false,
    analysis_source: "prepared_demo",
    analyzed_evidence_ids: opts.evidenceIds,
    image_hashes: opts.imageHashes,
    input_fingerprint: opts.inputFingerprint,
    quality_warnings: opts.qualityWarnings,
  };

  return {
    matched: true,
    scenario: matchedScenario,
    findings,
    recommendation: matchedScenario.suggested_outcome,
  };
}
