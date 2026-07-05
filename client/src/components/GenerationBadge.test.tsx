import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GenerationBadge } from './GenerationBadge';

describe('GenerationBadge', () => {
  it('renders nothing when idle', () => {
    const { container } = render(
      <GenerationBadge genStatus="idle" batchProgress={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on success (the process tracker card + toast handle that)', () => {
    const { container } = render(
      <GenerationBadge genStatus="success" batchProgress={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on error', () => {
    const { container } = render(
      <GenerationBadge genStatus="error" batchProgress={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a lightning bolt when enhancing without batch progress', () => {
    render(<GenerationBadge genStatus="enhancing" batchProgress={null} />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveAccessibleName('生成中');
    expect(badge.textContent).toContain('⚡️');
    // Single-image mode never shows a counter after the bolt.
    expect(badge.textContent?.trim()).toBe('⚡️');
  });

  it('renders while generating', () => {
    render(<GenerationBadge genStatus="generating" batchProgress={null} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders while saving (the final step still counts as in-flight)', () => {
    render(<GenerationBadge genStatus="saving" batchProgress={null} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows N/M counter and accessible name when a batch is running', () => {
    render(
      <GenerationBadge genStatus="generating" batchProgress={{ current: 3, total: 10 }} />,
    );
    const badge = screen.getByRole('status');
    expect(badge.textContent).toContain('3/10');
    expect(badge).toHaveAccessibleName('画像 3/10 生成中');
  });
});
