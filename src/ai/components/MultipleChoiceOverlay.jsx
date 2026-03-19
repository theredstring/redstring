import React, { useState, useMemo } from 'react';
import './MultipleChoiceOverlay.css';
import headSvg from '../../assets/svg/wizard/head.svg';
import { useTheme } from '../../hooks/useTheme.js';

/**
 * Overlay for rendering a multiple choice question from the AI
 * @param {Object} props
 * @param {string} props.question The question text
 * @param {string[]} props.options The list of options
 * @param {Function} props.onSelect Callback when an option is selected or submitted
 * @param {Function} props.onDismiss Callback when the None button is clicked to dismiss
 */
export default function MultipleChoiceOverlay({ question, options, onSelect, onDismiss }) {
    const [otherText, setOtherText] = useState('');
    const [showOtherInput, setShowOtherInput] = useState(false);
    const theme = useTheme();

    const renderMarkdown = useMemo(() => {
        const escapeHtml = (str) =>
            str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        return (text) => {
            if (!text) return text;
            let html = escapeHtml(text);

            // Inline code
            html = html.replace(/`([^`]+)`/g, `<code style="background:${theme.canvas.inactive};padding:2px 4px;border-radius:3px;">$1</code>`);
            // ***bold+italic***
            html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
            // **bold**
            html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            // *italic*
            html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
            // Unordered lists
            html = html.replace(/^\s*-\s+(.*)$/gim, '<li style="margin-left:20px;margin-bottom:2px;">$1</li>');
            html = html.replace(/(?:<li[^>]*>.*?<\/li>\s*)+/g, (match) => {
                const clean = match.replace(/\n\s*</g, '<');
                return `<ul style="margin:4px 0;padding:0;list-style-type:disc;">${clean}</ul>`;
            });
            // Newlines to <br> (skip inside ul)
            html = html.split(/(<ul[\s\S]*?<\/ul>)/i).map(part => {
                if (part.startsWith('<ul')) return part;
                return part.replace(/\n/g, '<br>');
            }).join('');

            return html;
        };
    }, [theme.canvas.inactive]);

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
            <div className="mc-question-header">
                <img src={headSvg} alt="Wizard" className="mc-wizard-face" />
                <div className="mc-question" dangerouslySetInnerHTML={{ __html: renderMarkdown(question) }} />
            </div>
            <div className="mc-options">
                {options.map((opt, i) => (
                    <button
                        key={i}
                        className="mc-option-button"
                        onClick={() => handleOptionClick(opt)}
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(opt) }}
                    />
                ))}

                <button
                    className="mc-option-button mc-option-none"
                    onClick={handleNoneClick}
                >
                    None
                </button>

                {!showOtherInput && (
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
