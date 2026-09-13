/**
 * How a storage slot's header lays itself out as the panel narrows.
 *
 * A slot header carries a name on the left and its buttons on the right. Below
 * roughly 320px that stops fitting — the repository slot carries four buttons
 * now — so the buttons take a row of their own rather than squeezing the name
 * out of the box it is supposed to be naming.
 *
 * Their own row is also the moment they can stop being cramped. Sharing a line
 * they shrink and close their gaps to buy the name a few more pixels; once they
 * are not competing with it they go back to full size with a real gap between
 * them, which is what a touch target at that width needs anyway. So the narrow
 * layout is not a smaller version of the wide one — the buttons get BIGGER at
 * the point they stop sharing.
 *
 * Pure, and shared by both slots so they cannot drift apart.
 *
 * @param {Object} options
 * @param {boolean} options.isSlim - Container under ~480px.
 * @param {boolean} options.isVerySlim - Container under ~320px.
 * @param {Object} options.theme - For the label colour only.
 */
export const slotLayout = ({ isSlim = false, isVerySlim = false, theme }) => {
  const buttonsOwnRow = isVerySlim;

  return {
    buttonsOwnRow,
    buttonSize: buttonsOwnRow ? 18 : (isSlim ? 16 : 18),
    buttonStyle: buttonsOwnRow ? { padding: '6px' } : {},
    headerStyle: {
      display: 'flex',
      flexDirection: buttonsOwnRow ? 'column' : 'row',
      alignItems: buttonsOwnRow ? 'stretch' : 'center',
      justifyContent: 'space-between',
      gap: buttonsOwnRow ? 8 : 6,
      minWidth: 0
    },
    /*
     * `minWidth: 0` is what actually lets the name give way. Without it a long
     * repository name refuses to shrink below its content and pushes the
     * buttons out of the box however small they get — which is the failure
     * this whole module exists to prevent.
     */
    labelStyle: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
    labelTextStyle: {
      fontSize: '0.72rem',
      fontWeight: 600,
      color: theme?.canvas?.textPrimary,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    buttonRowStyle: {
      display: 'flex',
      alignItems: 'center',
      gap: buttonsOwnRow ? 8 : (isSlim ? 2 : 4),
      flexShrink: 0,
      // On their own row they read left-to-right as a toolbar. Sharing a line
      // they stay pinned to the right, against the name.
      justifyContent: buttonsOwnRow ? 'flex-start' : 'flex-end'
    }
  };
};

export default slotLayout;
