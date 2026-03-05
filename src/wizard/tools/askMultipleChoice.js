/**
 * askMultipleChoice - Halts execution and awaits user response
 */
export async function askMultipleChoice(args) {
    // Return a special result that the UI will intercept to prompt the user
    return {
        __requiresUserInput: true,
        type: 'multiple_choice',
        question: args.question,
        options: args.options
    };
}
