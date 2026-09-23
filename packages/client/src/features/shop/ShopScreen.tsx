import { EmptyState } from '../../ui';

/** Placeholder — replaced in wave 2. */
export function ShopScreen() {
  return (
    <section aria-labelledby="shop-heading" className="p-4 sm:p-6">
      <h1 id="shop-heading" className="text-2xl">Shop</h1>
      <EmptyState title="Coming up" body="Felts, card backs, frames and more will be for sale here." />
    </section>
  );
}
