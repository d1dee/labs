import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
    cleanup();
});

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }),
});

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}

class IntersectionObserverStub {
    root = null;
    rootMargin = '';
    thresholds: number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
        return [];
    }
}

Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverStub,
});
Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: IntersectionObserverStub,
});

if (!('fullscreenElement' in document)) {
    Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
        configurable: true,
    });
}

if (!Element.prototype.requestFullscreen) {
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
        writable: true,
        configurable: true,
        value: async function (this: Element) {
            Object.defineProperty(document, 'fullscreenElement', {
                value: this,
                writable: true,
                configurable: true,
            });
            document.dispatchEvent(new Event('fullscreenchange'));
        },
    });
}

if (!document.exitFullscreen) {
    Object.defineProperty(document, 'exitFullscreen', {
        writable: true,
        configurable: true,
        value: async () => {
            Object.defineProperty(document, 'fullscreenElement', {
                value: null,
                writable: true,
                configurable: true,
            });
            document.dispatchEvent(new Event('fullscreenchange'));
        },
    });
}
