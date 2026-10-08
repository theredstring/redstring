import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import TypeStatementDialog, { isTypeStatement } from '../../src/components/connections/TypeStatementDialog.jsx';

/**
 * An outgoing "instance of" / "subclass of" row in the semantic connection
 * list asks whether its other end becomes the Thing's type, the connection in
 * the Web, or both. The type is the default.
 */

afterEach(cleanup);

const WD = 'http://www.wikidata.org/prop/direct/';

describe('isTypeStatement', () => {
  it('takes outgoing instance of and subclass of, by Wikidata property', () => {
    expect(isTypeStatement({ direction: 'out', predicate: 'instance of', predicateUri: `${WD}P31` })).toBe(true);
    expect(isTypeStatement({ direction: 'out', predicate: 'subclass of', predicateUri: `${WD}P279` })).toBe(true);
  });

  it('takes them by key or label when there is no Wikidata property', () => {
    expect(isTypeStatement({ direction: 'out', predicate: 'Is A', predicateKey: 'instanceOf' })).toBe(true);
    expect(isTypeStatement({ direction: 'out', predicate: 'Subclass Of' })).toBe(true);
  });

  it('takes the other ways of saying it, in any case', () => {
    ['Type Of', 'type of', 'TYPE OF', 'is a', 'Is A Kind Of', 'kind of', 'subtype of', 'rdf:type', 'type',
      'subClassOf', 'Is An Instance Of', 'Has Type', 'wdt:P31', 'P279'].forEach((predicate) => {
      expect(isTypeStatement({ direction: 'out', predicate }), predicate).toBe(true);
    });
    expect(isTypeStatement({ direction: 'out', predicate: 'whatever', predicateUri: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' })).toBe(true);
    expect(isTypeStatement({ direction: 'out', predicate: 'whatever', predicateUri: 'https://www.wikidata.org/prop/direct/P279' })).toBe(true);
  });

  it('does not take predicates that only contain the words', () => {
    ['typeface', 'prototype of', 'P3179', 'is part of', 'kind'].forEach((predicate) => {
      expect(isTypeStatement({ direction: 'out', predicate }), predicate).toBe(false);
    });
  });

  it('leaves incoming ones and other predicates alone', () => {
    expect(isTypeStatement({ direction: 'in', predicate: 'instance of', predicateUri: `${WD}P31` })).toBe(false);
    expect(isTypeStatement({ direction: 'out', predicate: 'part of', predicateUri: `${WD}P361` })).toBe(false);
    expect(isTypeStatement(null)).toBe(false);
  });
});

const renderDialog = (props = {}) => {
  const onChoose = vi.fn();
  const onClose = vi.fn();
  render(
    <TypeStatementDialog
      seedName="Bakery"
      typeName="Company"
      predicate="instance of"
      currentTypeName={null}
      typeBlocked={false}
      onChoose={onChoose}
      onClose={onClose}
      {...props}
    />
  );
  return { onChoose, onClose };
};

describe('TypeStatementDialog', () => {
  it('offers the type, the connection and both, and closes on a choice', () => {
    const { onChoose, onClose } = renderDialog();
    fireEvent.click(screen.getByText('Both'));
    expect(onChoose).toHaveBeenCalledWith('both');
    expect(onClose).toHaveBeenCalled();
  });

  it('defaults to the type: Enter picks it', () => {
    const { onChoose } = renderDialog();
    const typeButton = screen.getByText('As the Type').closest('button');
    fireEvent.keyDown(typeButton.closest('[role="dialog"]'), { key: 'Enter' });
    expect(onChoose).toHaveBeenCalledWith('type');
  });

  it('names the type being replaced', () => {
    renderDialog({ currentTypeName: 'Shop' });
    expect(screen.getByText(/it replaces Shop/)).toBeTruthy();
  });

  it('refuses a type that would loop back, but still offers the connection', () => {
    const { onChoose } = renderDialog({ typeBlocked: true });
    expect(screen.getByText('As the Type').closest('button').disabled).toBe(true);
    expect(screen.getByText('Both').closest('button').disabled).toBe(true);
    fireEvent.click(screen.getByText('In the Web'));
    expect(onChoose).toHaveBeenCalledWith('web');
  });
});
