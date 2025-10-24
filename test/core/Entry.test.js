import { describe, it, expect } from 'vitest';
import Entry from '../../src/core/Entry'; // Updated path

describe('Entry Class', () => {
  it('should initialize with default values', () => {
    const entry = new Entry();
    expect(entry.getName()).toBe('Untitled');
    expect(entry.getDescription()).toBe('No description.');
    expect(entry.getPicture()).toBe('');
    expect(entry.getColor()).toBe('');
    expect(entry.getId()).toBeNull();
  });

  it('should initialize with provided values, including a string ID', () => {
    const testId = 'test-uuid-123';
    const entry = new Entry('Test Name', 'Test Desc', 'test.jpg', '#ff0000', testId);
    expect(entry.getName()).toBe('Test Name');
    expect(entry.getDescription()).toBe('Test Desc');
    expect(entry.getPicture()).toBe('test.jpg');
    expect(entry.getColor()).toBe('#ff0000');
    expect(entry.getId()).toBe(testId);
  });

  it('should allow setting and getting name', () => {
    const entry = new Entry();
    entry.setName('New Name');
    expect(entry.getName()).toBe('New Name');
  });

  it('should allow setting and getting description', () => {
    const entry = new Entry();
    entry.setDescription('New Desc');
    expect(entry.getDescription()).toBe('New Desc');
  });

  it('should allow setting and getting picture', () => {
    const entry = new Entry();
    entry.setPicture('new.png');
    expect(entry.getPicture()).toBe('new.png');
  });

  it('should allow setting and getting color', () => {
    const entry = new Entry();
    entry.setColor('#00ff00');
    expect(entry.getColor()).toBe('#00ff00');
  });

  it('should allow setting and getting a string id', () => {
    const entry = new Entry();
    const newId = 'new-uuid-456';
    entry.setId(newId);
    expect(entry.getId()).toBe(newId);
  });

  it('should allow setting and getting a null id', () => {
    const entry = new Entry(undefined, undefined, undefined, undefined, 'initial-id');
    entry.setId(null);
    expect(entry.getId()).toBeNull();
  });
}); 