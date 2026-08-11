export const SRD_PDF_PATH = "systems/fvtt-yze-srd/YZE-Standard-Reference-Document.pdf";

const rulesIndex = `
<h1>Year Zero Engine Standard Reference Document</h1>
<p>This searchable index accompanies the complete, fully formatted SRD on the <strong>Full SRD (PDF)</strong> page of this Journal. Open that page and use the PDF viewer's Find command (<kbd>Ctrl</kbd>+<kbd>F</kbd>, or <kbd>Cmd</kbd>+<kbd>F</kbd> on macOS) to search the complete rules text.</p>
<p>The page numbers below refer to the numbered pages in the embedded PDF.</p>

<h2>1. Introduction — pages 2–3</h2>
<p>Roleplaying basics; players and Gamemaster; core Year Zero Engine features; player-centric and story-driven play; Dice Pools versus Stepped Dice; dice notation; rounds, stretches, and shifts; character sheets; custom cards; playing safely.</p>

<h2>2. Player Characters — pages 4–7</h2>
<p>Character creation; archetypes; Attributes; Dice Pool and Stepped Dice ratings; Health and Resolve; Skills; Specialities; Gear; Consumables and Supply; personality traits; relationships; experience points and advancement.</p>

<h2>3. Skills &amp; Specialities — pages 8–14</h2>
<p>Skill rolls; successes and failure; pushing rolls; banes; Stress Dice; panic; Conditions; Doom Points; Advantage and Disadvantage; difficulty; opposed rolls; help; Gear bonuses and degradation; the twelve core Skills; sample Specialities; Willpower Specialities.</p>

<h2>4. Combat &amp; Damage — pages 15–29</h2>
<p>Initiative; surprise; rounds and turns; slow and fast actions; zones and range; movement; ambushes; melee and ranged combat; blocking; full-auto fire; overwatch; Weapons; Armour; cover; damage and stress; broken characters; recovery; critical injuries; hazards; vehicles; vehicle damage; chases and obstacles.</p>

<h2>5. Magic — pages 30–40</h2>
<p>Spellcasting; Magic disciplines; Willpower Points; power level; range and duration; overcharging; Magic mishaps; dispelling; grimoires; teachers; awareness, healing, shapeshifting, telepathy, elemental, death, and generalist spell examples.</p>

<h2>6. Travel — pages 41–45</h2>
<p>Travel maps and hexes; terrain; travel speed; shifts; roles; forced marching; darkness; weather; roads; mounted travel; vehicles and fuel; foraging; hunting; fishing; making camp; sleep; camp mishaps.</p>

<hr>
<p><strong>Licence notice:</strong> This game is not affiliated with, sponsored, or endorsed by Fria Ligan AB. The Year Zero Engine System Reference Document is used under Fria Ligan AB's Free Tabletop License. See the opening page of the embedded PDF and the supplied licence document for details.</p>
`;

export const SRD_JOURNAL = Object.freeze({
  name: "Year Zero Engine SRD",
  pages: Object.freeze([
    Object.freeze({
      name: "Rules Index",
      type: "text",
      sort: 100000,
      text: Object.freeze({
        content: rulesIndex,
        format: 1
      })
    }),
    Object.freeze({
      name: "Full SRD (PDF)",
      type: "pdf",
      sort: 200000,
      src: SRD_PDF_PATH
    })
  ])
});
