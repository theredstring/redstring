import React from 'react';

const StandardDivider = ({ 
  margin = '15px 0', 
  width = '100%',
  style = {} 
}) => {
  return (
    <div 
      style={{
        borderTop: '1px solid #260000',
        margin,
        width,
        ...style
      }}
    />
  );
};

export default StandardDivider;
