/**
 * Curated local repair inspection guidelines for PunchPay's advisory AI reviewer.
 * IMPORTANT: Entries define what visual attributes to examine and what photos cannot
 * prove — they NEVER predetermine pass/fail findings for any task.
 */

export interface RepairKnowledgeCategory {
  id: "interior_painting" | "tile_repair" | "wall_patching" | "flooring_defects";
  label: string;
  keywords: string[];
  inspectable_criteria: string[];
  recommended_photos: string[];
  common_visible_concerns: string[];
  cannot_assess_from_photos: string[];
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
    common_visible_concerns: [
      "Raised joint compound ridge or rectangular patch outline visible in side light",
      "Unfilled hairline crack or unprimed chalky compound",
      "Rough texture mismatch relative to adjacent drywall",
    ],
    cannot_assess_from_photos: [
      "Structural backing, framing stud attachment, or moisture intrusion behind the drywall",
      "Curing completeness prior to priming unless clearly dry and finished",
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
    common_visible_concerns: [
      "Open end-joint gaps or chipped locking tongues between planks",
      "Raised edge or uneven transition height",
      "Visible scratches, adhesive residue, or mismatched finish sheen",
    ],
    cannot_assess_from_photos: [
      "Subfloor levelness, moisture barrier installation, or acoustic underlayment condition",
      "Squeaks, vertical deflection under foot traffic, or locking-mechanism wear underneath planks",
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
