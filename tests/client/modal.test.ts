import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/client/components/Modal.css', () => ({}));

import Modal, { type ModalProps } from '../../src/client/components/Modal';

type ClickProps = {
  className?: string;
  style?: React.CSSProperties;
  onClick: (e: { stopPropagation: () => void }) => void;
  children: React.ReactNode;
};

function render(props: Partial<ModalProps> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const backdrop = Modal({
    onClose,
    children: 'body',
    ...props,
  }) as React.ReactElement<ClickProps>;
  const content = backdrop.props.children as React.ReactElement<ClickProps>;
  const [close, body] = React.Children.toArray(
    content.props.children,
  ) as React.ReactElement<ClickProps>[];
  return { onClose, backdrop, content, close, body };
}

describe('Modal', () => {
  it('keeps the class names the stylesheet and e2e specs rely on', () => {
    const { backdrop, content, close } = render();
    expect(backdrop.props.className).toBe('modal show');
    expect(content.props.className).toBe('modal-content');
    expect(content.props.style).toBeUndefined();
    expect(close.props.className).toBe('close');
  });

  it('closes on backdrop and × clicks without passing the event through', () => {
    const { onClose, backdrop, close } = render();
    backdrop.props.onClick({ stopPropagation: vi.fn() });
    close.props.onClick({ stopPropagation: vi.fn() });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenNthCalledWith(1);
    expect(onClose).toHaveBeenNthCalledWith(2);
  });

  it('stops clicks inside the content from reaching the backdrop', () => {
    const { onClose, content } = render();
    const stopPropagation = vi.fn();
    content.props.onClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves dismissal guards to the caller', () => {
    let saving = true;
    const close = vi.fn();
    const { backdrop } = render({ onClose: () => !saving && close() });
    backdrop.props.onClick({ stopPropagation: vi.fn() });
    expect(close).not.toHaveBeenCalled();
    saving = false;
    backdrop.props.onClick({ stopPropagation: vi.fn() });
    expect(close).toHaveBeenCalledOnce();
  });

  it('applies size as max-width and appends extra classes', () => {
    expect(render({ size: 500 }).content.props.style).toEqual({
      maxWidth: 500,
    });
    expect(render({ size: '95%' }).content.props.style).toEqual({
      maxWidth: '95%',
    });
    expect(
      render({ className: 'score-view-modal' }).content.props.className,
    ).toBe('modal-content score-view-modal');
  });

  it('renders children after the close control', () => {
    expect(render().body).toBe('body');
  });
});
