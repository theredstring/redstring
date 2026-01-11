
// Logic extracted from LLMClient.js to reproduce JSON.parse error on truncation

const partialJson = '{"name": "Iron Man", "description": "Tony Sta'; // Truncated

try {
    console.log('Attempting to parse truncated JSON...');
    const result = JSON.parse(partialJson);
    console.log('Success:', result);
} catch (error) {
    console.log('Caught expected error:', error.message);
}

// Logic with the proposed fix
console.log('\n--- Testing Fix ---');
try {
    const result = JSON.parse(partialJson);
    console.log('Success:', result);
} catch (e) {
    console.log('Safely caught error:', e.message);
    const safeError = { error: 'Response was truncated by the spell!' };
    console.log('Returning safe error:', safeError);
}
