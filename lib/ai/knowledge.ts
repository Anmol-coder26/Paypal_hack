import type { AIStructuredFindings, TaskBundle } from "../types";

/**
 * Curated local repair inspection guidelines for PunchPay's advisory AI reviewer
 * and Level 3 Guided Checklist Fallback.
 * IMPORTANT: Entries define what visual attributes to examine and what photos cannot
 * prove — they NEVER predetermine pass/fail findings or fabricate AI photo inspection.
 */

export interface GuidedQuestionItem {
  id: string;
  question: string;
  concernSummary: string;
}

export interface RepairKnowledgeCategory {
  id: "interior_painting" | "tile_repair" | "wall_patching" | "flooring_defects";
  label: string;
  keywords: string[];
  inspectable_criteria: string[];
  recommended_photos: string[];
  guided_questions: GuidedQuestionItem[];
  common_visible_concerns: string[];
  cannot_assess_from_photos: string[];
  suggested_next_actions: string[];
  cautious_observation_examples: string[];
}

export const REPAIR_KNOWLEDGE_BASE: RepairKnowledgeCategory[] = [
  {
    id: "interior_painting",
    label: "Interior Painting",
    keywords: ["paint", "painting", "repaint", "coat", "primer", "wall finish", "trim", "cut-in"],
    inspectable_criteria: [
      "Apparent coverage uniformity across the target wall section compared with the before photograph",
      "Visibility of prior scuff marks, stains, bare primer patches, or lap lines in the after photograph",
      "Cleanliness of paint cut-in edges along window frames, baseboards, outlets, and corners",
    ],
    recommended_photos: [
      "One wide shot showing the same wall corner or window landmark in both before and after views",
      "One medium close-up under even interior lighting to show surface finish without harsh flash glare",
    ],
    guided_questions: [
      {
        id: "paint_uniform",
        question: "Is the paint coverage visually uniform across the repaired wall area?",
        concernSummary: "User reported uneven paint coverage or sheen patches.",
      },
      {
        id: "paint_unpainted",
        question: "Are there no visible unpainted patches, scuff bleed-through, or missed trim edges?",
        concernSummary: "User reported visible unpainted patches or bleed-through.",
      },
      {
        id: "paint_framing",
        question: "Are the Before and After photos clear enough to compare the same wall section?",
        concernSummary: "User reported a closer or clearer photograph is needed for paint comparison.",
      },
    ],
    common_visible_concerns: [
      "Bleed-through of original dark marks or uneven sheen patches",
      "Paint overlap onto adjacent trim, caulk, or hardware",
      "Holiday spots (unpainted pinholes or missed corner edges)",
    ],
    cannot_assess_from_photos: [
      "Wet-film or dry-film paint thickness, VOC content, or coat count",
      "Exact color match against a physical paint chip under changing daylight",
      "Surface adhesion or primer prep quality beneath the topcoat",
    ],
    suggested_next_actions: [
      "Proceed to homeowner review",
      "Request a closer photograph under even lighting",
      "Request a touch-up coat before accepting payment",
    ],
    cautious_observation_examples: [
      "After photo shows uniform color over the area where dark scuff marks appeared in the before image.",
      "Direct window reflection partially obscures sheen consistency along the left edge.",
    ],
  },
  {
    id: "tile_repair",
    label: "Tile Repair",
    keywords: ["tile", "tiles", "grout", "backsplash", "ceramic", "porcelain", "caulk"],
    inspectable_criteria: [
      "Removal or replacement of the cracked or chipped tile shown in the before photograph",
      "Course and joint alignment relative to adjacent tiles horizontally and vertically",
      "Continuity and fill of surrounding grout or perimeter sealant lines without open dark voids",
    ],
    recommended_photos: [
      "A straight-on framing of the damaged tile plus at least two neighboring tiles for alignment comparison",
      "A slightly angled view across grout joints to reveal lippage or recessed edges",
    ],
    guided_questions: [
      {
        id: "tile_replaced",
        question: "Was the cracked or damaged tile clearly replaced in the After photograph?",
        concernSummary: "User reported the damaged tile replacement could not be confirmed.",
      },
      {
        id: "tile_aligned",
        question: "Does the replacement tile appear aligned with adjacent tiles?",
        concernSummary: "User reported visible tile alignment offset relative to neighboring tiles.",
      },
      {
        id: "tile_gaps",
        question: "Are surrounding grout lines filled with no obvious gaps or unfinished edges?",
        concernSummary: "User reported visible gaps or unfinished grout around the replacement tile.",
      },
    ],
    common_visible_concerns: [
      "Open dark gaps or missing grout along tile edges",
      "Noticeable horizontal or vertical alignment offset compared to surrounding courses",
      "Visible cracks, chips, or smeared cured grout haze on the tile face",
    ],
    cannot_assess_from_photos: [
      "Thin-set mortar coverage, trowel notch bond, or hollow spots behind the tile",
      "Subsurface waterproofing membrane integrity or long-term water tightness",
      "Sub-millimeter flatness across wide surfaces from a single 2D angle",
    ],
    suggested_next_actions: [
      "Request a closer photograph of the grout edges before deciding",
      "Request grout completion or tile realignment before capture",
      "Proceed to homeowner settlement decision",
    ],
    cautious_observation_examples: [
      "Replacement tile appears intact, though a dark gap remains visible along the right perimeter joint in the after photo.",
      "Photographs cannot confirm mortar coverage or waterproof membrane condition behind the backsplash.",
    ],
  },
  {
    id: "wall_patching",
    label: "Wall Patching & Drywall Repair",
    keywords: ["patch", "patching", "drywall", "hole", "plaster", "spackle", "mud", "crack"],
    inspectable_criteria: [
      "Closure of the opening, dent, or crack documented in the before image",
      "Surface flushness and feathering compared against surrounding wall texture",
      "Absence of visible tape ridges, exposed mesh, or deep sanding depressions",
    ],
    recommended_photos: [
      "Before and after views from the same distance with a fixed landmark (outlet, trim, or corner) visible",
      "An oblique side-lit shot to reveal raised compound ridges or sunken patch seams",
    ],
    guided_questions: [
      {
        id: "patch_closed",
        question: "Does the opening or hole from the Before photograph appear fully patched?",
        concernSummary: "User reported the opening or crack still appears partially visible.",
      },
      {
        id: "patch_flush",
        question: "Does the patched surface appear flush without visible ridges or tape edges?",
        concernSummary: "User reported visible compound ridges or uneven feathering.",
      },
      {
        id: "patch_angle",
        question: "Is there an angled side-lit photo showing surface flatness clearly?",
        concernSummary: "User reported a side-lit photo is needed to judge surface flushness.",
      },
    ],
    common_visible_concerns: [
      "Raised joint compound ridge or rectangular patch outline visible in side light",
      "Unfilled hairline crack or unprimed chalky compound",
      "Rough texture mismatch relative to adjacent drywall",
    ],
    cannot_assess_from_photos: [
      "Structural backing, framing stud attachment, or moisture intrusion behind the drywall",
      "Curing completeness prior to priming unless clearly dry and finished",
    ],
    suggested_next_actions: [
      "Request an angled close-up photograph under side light",
      "Request additional feather sanding before painting",
      "Proceed to homeowner review",
    ],
    cautious_observation_examples: [
      "The hole visible in the before photo is filled, though surface smoothness is partly obscured by frontal flash.",
      "Images do not indicate whether framing backing or moisture remediation was performed behind the patch.",
    ],
  },
  {
    id: "flooring_defects",
    label: "Visible Flooring Defects",
    keywords: ["floor", "flooring", "plank", "hardwood", "laminate", "vinyl", "lvp", "scratches", "board"],
    inspectable_criteria: [
      "Resolution of surface gouges, cracked boards, or lifted seams shown in the before photograph",
      "Tightness of plank seams and transition strips without visible tripping lips or gaps",
      "Visual continuity of grain direction and sheen across the repaired section",
    ],
    recommended_photos: [
      "Overhead view centered on the repaired plank plus a low-angle view showing seam flushness",
      "Wide reference shot establishing room location and surrounding transition moldings",
    ],
    guided_questions: [
      {
        id: "floor_resolved",
        question: "Are the surface gouges or damaged boards from the Before photo resolved?",
        concernSummary: "User reported surface board damage remains visible.",
      },
      {
        id: "floor_seams",
        question: "Do plank seams and transition edges appear closed and flush without gaps?",
        concernSummary: "User reported open seams or raised edge lippage.",
      },
      {
        id: "floor_photo",
        question: "Are the supplied overhead/low-angle photos sharp enough to verify?",
        concernSummary: "User reported a closer low-angle photo is needed to inspect plank flushness.",
      },
    ],
    common_visible_concerns: [
      "Open end-joint gaps or chipped locking tongues between planks",
      "Raised edge or uneven transition height",
      "Visible scratches, adhesive residue, or mismatched finish sheen",
    ],
    cannot_assess_from_photos: [
      "Subfloor levelness, moisture barrier installation, or acoustic underlayment condition",
      "Squeaks, vertical deflection under foot traffic, or locking-mechanism wear underneath planks",
    ],
    suggested_next_actions: [
      "Request a low-angle photograph across the plank seam",
      "Inspect seam tightness or subfloor deflection in person",
      "Proceed to homeowner review",
    ],
    cautious_observation_examples: [
      "The split plank seam visible in the before image appears closed in the after view, though seam flushness under weight cannot be tested from photos.",
      "Subfloor condition and moisture readings cannot be observed in surface photographs.",
    ],
  },
];

export function retrieveRepairKnowledge(title: string, description: string): RepairKnowledgeCategory[] {
  const haystack = `${title} ${description}`.toLowerCase();
  const matched = REPAIR_KNOWLEDGE_BASE.filter((cat) =>
    cat.keywords.some((kw) => haystack.includes(kw))
  );
  return matched.slice(0, 2);
}

export function formatKnowledgeForPrompt(categories: RepairKnowledgeCategory[]): string {
  if (!categories.length) {
    return "No specific category sheet matched; inspect strictly against the user's stated acceptance criteria and flag anything not directly observable.";
  }
  return categories
    .map((cat) =>
      [
        `Category Guideline (${cat.label} — inspection checklist only, NOT an assumed result):`,
        `- Visually inspectable areas: ${cat.inspectable_criteria.join("; ")}`,
        `- Common defects to watch for if present: ${cat.common_visible_concerns.join("; ")}`,
        `- Conditions photos CANNOT establish: ${cat.cannot_assess_from_photos.join("; ")}`,
      ].join("\n")
    )
    .join("\n\n");
}

export function getGuidedChecklistTemplate(task: Pick<TaskBundle, "title" | "description" | "acceptance_criteria">) {
  const cats = retrieveRepairKnowledge(task.title, task.description);
  const primary = cats[0];
  const criteriaQuestions: GuidedQuestionItem[] =
    primary?.guided_questions ??
    task.acceptance_criteria.map((c, idx) => ({
      id: `crit_${idx}`,
      question: `From the submitted photos, does "${c}" appear satisfied?`,
      concernSummary: `User flagged concern regarding criterion: ${c}.`,
    }));

  return {
    categoryLabel: primary?.label ?? "General Repair Inspection",
    recommendedPhotos: primary?.recommended_photos ?? [
      "Wide framing linking both Before and After stages to a fixed room landmark",
      "Clear close-up photograph under even lighting",
    ],
    questions: criteriaQuestions,
    limitations: primary?.cannot_assess_from_photos ?? [
      "Guided inspection relies on user-reported visual judgment; internal installation and structural adherence cannot be verified from photos alone.",
    ],
    suggestedNextActions: primary?.suggested_next_actions ?? [
      "Proceed to homeowner review",
      "Request a closer photograph",
      "Request a correction",
    ],
  };
}

export interface GuidedCriterionInput {
  criterion: string;
  status: "satisfied" | "unmet" | "unverifiable";
  note?: string;
}

/**
 * Generates an honest, strictly non-AI structured checklist report solely from
 * user-supplied answers. Never claims AI analyzed image pixels.
 */
export function buildGuidedChecklistFindings(opts: {
  task: Pick<TaskBundle, "title" | "description" | "acceptance_criteria">;
  criteriaResponses: GuidedCriterionInput[];
  needsCloserPhoto?: boolean;
  reviewerNotes?: string;
  qualityWarnings?: string[];
  evidenceIds?: string[];
  imageHashes?: string[];
}): AIStructuredFindings {
  const template = getGuidedChecklistTemplate(opts.task);
  const checks = opts.task.acceptance_criteria.map((criterion, idx) => {
    const match =
      opts.criteriaResponses.find((r) => r.criterion === criterion) ?? opts.criteriaResponses[idx];
    const status = match?.status ?? "unverifiable";
    const cleanedNote = (match?.note || "").trim();
    const observation =
      cleanedNote ||
      (status === "satisfied"
        ? "Reviewer checked this criterion as visually supported (user-reported, not AI pixel inference)."
        : status === "unmet"
        ? "Reviewer reported a visible concern for this criterion (user-reported)."
        : "Reviewer marked this criterion cannot be determined from current photographs.");
    return { criterion, status, observation };
  });

  const satisfied = checks.filter((c) => c.status === "satisfied").map((c) => c.criterion);
  const unmet = checks.filter((c) => c.status === "unmet").map((c) => c.criterion);
  const unverifiable = checks.filter((c) => c.status === "unverifiable").map((c) => c.criterion);

  let overall_assessment: AIStructuredFindings["overall_assessment"] = "insufficient_evidence";
  let suggested_outcome: AIStructuredFindings["suggested_outcome"] = "request_more_evidence";
  let summary =
    "Guided review recorded by user because AI vision analysis was unavailable; additional evidence or closer framing was requested.";
  let nextStep = "Request a closer photograph before accepting payment.";

  if (unmet.length > 0) {
    overall_assessment = "concerns_identified";
    suggested_outcome = "review_concerns";
    summary = `User-reported guided inspection noted visible concerns on ${unmet.length} criterion/criteria (${unmet.join("; ")}).`;
    nextStep = opts.needsCloserPhoto
      ? "Request a closer photograph and inspect visible concerns before deciding."
      : "Inspect the user-reported concerns or request a correction before accepting.";
  } else if (opts.needsCloserPhoto || unverifiable.length > 0) {
    overall_assessment = "insufficient_evidence";
    suggested_outcome = "request_more_evidence";
    summary =
      "User-reported guided inspection marked evidence inconclusive without AI image inference.";
    nextStep = "Request a closer photograph showing all acceptance criteria clearly.";
  } else if (satisfied.length === checks.length && checks.length > 0) {
    overall_assessment = "appears_satisfied";
    suggested_outcome = "accept";
    summary =
      "User-reported guided inspection marked all agreed criteria satisfied while AI vision was unavailable.";
    nextStep = "Proceed to homeowner review using your recorded checklist observations.";
  }

  const visibleObservations = [
    ...(opts.reviewerNotes?.trim()
      ? [`User observation: ${opts.reviewerNotes.trim()}`]
      : []),
    ...checks.map((c) => `${c.criterion}: ${c.observation}`),
  ].slice(0, 4);

  return {
    overall_assessment,
    summary,
    views_comparable: opts.needsCloserPhoto ? "partly" : "yes",
    visible_observations: visibleObservations.length
      ? visibleObservations
      : ["Guided checklist recorded without AI image inference."],
    criteria_checks: checks,
    criteria_satisfied: satisfied,
    criteria_unmet: unmet,
    criteria_unverifiable: unverifiable,
    missing_evidence: opts.needsCloserPhoto
      ? ["Closer photograph requested during guided checklist review."]
      : [],
    recommended_next_steps: [nextStep],
    suggested_outcome,
    limitations_and_uncertainty: [
      "AI photo analysis did not inspect these images; findings reflect homeowner/reviewer checklist answers only.",
      ...template.limitations,
    ].slice(0, 4),
    is_genuine_ai: false,
    analysis_source: "guided_checklist",
    analyzed_evidence_ids: opts.evidenceIds ?? [],
    image_hashes: opts.imageHashes ?? [],
    quality_warnings: opts.qualityWarnings ?? [],
  };
}
