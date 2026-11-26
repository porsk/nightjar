type Listener = (event: Event) => void

/** A stand-in for the live updates stream. Tests push events with `emit`. */
export class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly url: string
  closed = false
  private listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close() {
    this.closed = true
  }

  emit(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) })
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

/** A stand-in for the browser's scroll watcher. Tests call `show` to say the element is on screen. */
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  private readonly callback: IntersectionObserverCallback
  private elements = new Set<Element>()

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }

  observe(element: Element) {
    this.elements.add(element)
  }

  unobserve(element: Element) {
    this.elements.delete(element)
  }

  disconnect() {
    this.elements.clear()
  }

  show() {
    const entries = [...this.elements].map((target) => ({ isIntersecting: true, target }))
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver)
  }
}
