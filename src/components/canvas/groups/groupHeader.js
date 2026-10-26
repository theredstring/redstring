/**
 * A Thing-group's header: the band above its interior, where the title sits,
 * filled in the group's colour and drawn with the titles (above connections),
 * so a connection running through the header passes behind it, as one does
 * behind a node. groupElements draws it and the drag (useNodeDrag) reshapes it
 * per frame from the same layout numbers.
 *
 * The outline is left open along the bottom: a selected group's stroke runs up
 * the sides and over the top like the band's, never across the interior's edge.
 */
export function groupHeaderPath(x, top, w, bottom, r) {
  const right = x + w;
  return `M ${x} ${bottom} L ${x} ${top + r} A ${r} ${r} 0 0 1 ${x + r} ${top} `
    + `L ${right - r} ${top} A ${r} ${r} 0 0 1 ${right} ${top + r} L ${right} ${bottom}`;
}
