/**
 * Jest stub for `svelte/store`.
 *
 * Minimal writable/derived/get implementation that satisfies the
 * OverlayModel constructor. Subscribers are invoked synchronously on
 * subscribe and on every set/update — enough for the wrapper-lifecycle
 * tests; full reactive semantics are exercised in the browser.
 */

type Subscriber<T> = (value: T) => void;

export interface Readable<T> {
  subscribe(run: Subscriber<T>): () => void;
}

export interface Writable<T> extends Readable<T> {
  set(value: T): void;
  update(updater: (value: T) => T): void;
}

export function writable<T>(initial: T): Writable<T> {
  let value = initial;
  const subs = new Set<Subscriber<T>>();
  return {
    subscribe(run) {
      subs.add(run);
      run(value);
      return () => subs.delete(run);
    },
    set(next) {
      value = next;
      for (const s of subs) s(value);
    },
    update(updater) {
      value = updater(value);
      for (const s of subs) s(value);
    },
  };
}

export function get<T>(store: Readable<T>): T {
  let value!: T;
  const unsubscribe = store.subscribe((v) => {
    value = v;
  });
  unsubscribe();
  return value;
}

type Stores = Readable<unknown> | Array<Readable<unknown>>;
type StoresValues<T> = T extends Readable<infer U>
  ? U
  : { [K in keyof T]: T[K] extends Readable<infer U> ? U : never };

export function derived<S extends Stores, T>(
  stores: S,
  fn: (values: StoresValues<S>) => T,
): Readable<T> {
  const arr = (Array.isArray(stores) ? stores : [stores]) as Array<Readable<unknown>>;
  const single = !Array.isArray(stores);
  return {
    subscribe(run) {
      const values: unknown[] = new Array(arr.length);
      const unsubs: Array<() => void> = [];
      let initialized = 0;
      const recompute = () => {
        if (initialized < arr.length) return;
        const input = (single ? values[0] : values) as StoresValues<S>;
        run(fn(input));
      };
      arr.forEach((store, i) => {
        unsubs.push(
          store.subscribe((v) => {
            values[i] = v;
            if (initialized < arr.length) initialized += 1;
            recompute();
          }),
        );
      });
      return () => unsubs.forEach((u) => u());
    },
  };
}
