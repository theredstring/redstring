import React from 'react';
import { useTheme } from '../hooks/useTheme.js';

const StandardDivider = ({
  margin = '15px 0',
  width = '100%',
  style = {}
}) => {
  const theme = useTheme();
  return (
    <div
      style={{
        borderTop: `1px solid ${theme.canvas.textPrimary}`,
        margin,
        width,
        ...style
      }}
    />
  );
};

export default StandardDivider;
