export const STATUS_TONES = ['success', 'warning', 'error', 'info'];

export function getStatusColors(darkMode) {
  return {
    success: darkMode ? '#E7E79E' : '#354702',
    warning: darkMode ? '#b39ddb' : '#512da8',
    error: darkMode ? '#C09191' : '#7A0000',
    info: darkMode ? '#64b5f6' : '#1565c0'
  };
}

export function getStatusColor(tone, darkMode) {
  const colors = getStatusColors(darkMode);
  return colors[tone] || colors.info;
}
