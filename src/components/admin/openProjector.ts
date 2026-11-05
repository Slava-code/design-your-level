/** Opens (or focuses) the projector tab. A named window means repeated clicks reuse the same tab. */
export function openProjector() {
  const w = window.open("/screen", "dyl-projector");
  w?.focus();
}
