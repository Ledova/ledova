// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { QRScannerView } from './QRScannerView';

afterEach(() => {
  cleanup();
});

it('shows a camera error on the page surface, not inside the black camera viewport', () => {
  const { container } = render(<QRScannerView scannerId="scanner" error="Requested device not found" />);

  const viewport = container.querySelector('#scanner')?.parentElement;
  const message = screen.getByText('Requested device not found');

  expect(viewport?.className).toContain('bg-black');
  expect(viewport?.contains(message)).toBe(false);
});

it('keeps the error visible when a caller sizes the viewport to clip its content', () => {
  const { container } = render(
    <QRScannerView
      scannerId="scanner"
      error="Camera permission denied"
      className="relative overflow-hidden rounded-lg bg-black"
      style={{ width: 220, height: 220 }}
    />,
  );

  const viewport = container.querySelector('#scanner')?.parentElement;

  expect(viewport?.style.height).toBe('220px');
  expect(viewport?.contains(screen.getByText('Camera permission denied'))).toBe(false);
});
