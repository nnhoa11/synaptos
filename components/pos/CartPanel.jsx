import Button from "@/components/ui/Button";
import { currency } from "@/lib/prototype-core";

export default function CartPanel({
  items = [],
  onChangeQty,
  onCheckout,
  onClear,
  onRemove,
  onShrinkage,
  total,
}) {
  return (
    <div className="pos-cart-panel">
      <div className="pos-cart-items">
        <div className="stack">
          {items.length ? (
            items.map((item) => (
              <div className="cart-line" key={item.skuId}>
                <div className="stack" style={{ gap: 2 }}>
                  <strong>{item.productName}</strong>
                  <span className="metric-footnote">{currency(item.unitPrice)} each</span>
                </div>
                <div className="row">
                  <Button size="sm" variant="secondary" onClick={() => onChangeQty(item.skuId, item.quantity - 1)}>
                    -
                  </Button>
                  <strong>{item.quantity}</strong>
                  <Button size="sm" variant="secondary" onClick={() => onChangeQty(item.skuId, item.quantity + 1)}>
                    +
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onRemove(item.skuId)}>
                    ×
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <p className="empty-state__copy">Add products from the left grid to start an order.</p>
            </div>
          )}
        </div>
      </div>
      <div className="pos-cart-footer">
        <div className="row-between">
          <span>Subtotal</span>
          <strong>{currency(total)}</strong>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Button className="pos-checkout-button" onClick={onCheckout}>
            Checkout
          </Button>
          <Button variant="secondary" onClick={onClear}>
            Clear Order
          </Button>
        </div>
        <button className="text-button" onClick={onShrinkage} type="button">
          Shrinkage Input
        </button>
      </div>
    </div>
  );
}
