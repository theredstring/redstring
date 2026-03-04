import React, { useState } from 'react';
import './MultipleChoiceOverlay.css';

/**
 * Overlay for rendering a multiple choice question from the AI
 * @param {Object} props
 * @param {string} props.question The question text
 * @param {string[]} props.options The list of options
 * @param {Function} props.onSelect Callback when an option is selected or submitted
 * @param {Function} props.onDismiss Callback when the None button is clicked to dismiss
 */
export default function MultipleChoiceOverlay({ question, options, allowOther, onSelect, onDismiss }) {
    const [otherText, setOtherText] = useState('');
    const [showOtherInput, setShowOtherInput] = useState(false);

    const handleOptionClick = (option) => {
        onSelect(option);
    };

    const handleNoneClick = () => {
        if (onDismiss) onDismiss();
    };

    const handleOtherSubmit = (e) => {
        e.preventDefault();
        if (otherText.trim()) {
            onSelect(otherText.trim());
        }
    };

    return (
        <div className="mc-overlay-container">
            <div className="mc-question">{question}</div>
            <div className="mc-options">
                {options.map((opt, i) => (
                    <button
                        key={i}
                        className="mc-option-button"
                        onClick={() => handleOptionClick(opt)}
                    >
                        {opt}
                    </button>
                ))}

                <button
                    className="mc-option-button mc-option-none"
                    onClick={handleNoneClick}
                >
                    None
                </button>

                {allowOther && !showOtherInput && (
                    <button
                        className="mc-option-button mc-option-other"
                        onClick={() => setShowOtherInput(true)}
                    >
                        Other...
                    </button>
                )}
            </div>

            {showOtherInput && (
                <form className="mc-other-form" onSubmit={handleOtherSubmit}>
                    <input
                        type="text"
                        className="mc-other-input"
                        value={otherText}
                        onChange={(e) => setOtherText(e.target.value)}
                        placeholder="Type your answer..."
                        autoFocus
                    />
                    <button type="submit" className="mc-other-submit">Submit</button>
                </form>
            )}
        </div>
    );
}
