import { createContext } from 'react';

/**
 * Whether the panel this content sits in is open. A closed panel stays mounted
 * (it slides off screen), so content that is costly to keep current reads this
 * and holds still while it can't be seen. Outside a panel, content is shown.
 */
export const PanelOpenContext = createContext(true);
