'use client';
import { api } from './billing-client';
import { refreshFinanceFromServer } from './local-data';

export interface GatewayPublic { enabled: boolean; keyId?: string; mode?: 'live' | 'test' }

export const getGatewayPublic = () => api<GatewayPublic>('/api/payment-gateway/public');

let checkoutLoading: Promise<void> | null = null;
function loadCheckout(): Promise<void> {
  if ((window as any).Razorpay) return Promise.resolve();
  if (!checkoutLoading) {
    checkoutLoading = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { checkoutLoading = null; reject(new Error('Could not load Razorpay Checkout. Check your internet connection.')); };
      document.body.appendChild(s);
    });
  }
  return checkoutLoading;
}

/**
 * Collect payment for an invoice through Razorpay Checkout. Resolves 'paid' once the SERVER has verified the signature and
 * confirmed the capture with Razorpay (invoice is then Paid and booked to income); 'dismissed' if the payer closed the window.
 */
export async function payInvoiceOnline(invoiceId: string): Promise<'paid' | 'dismissed'> {
  const order = await api<{
    keyId: string; orderId: string; amount: number; currency: string; invoiceNumber: string; prefill: { name: string; email: string };
  }>(`/api/invoices/${invoiceId}/razorpay/order`, 'POST', {});
  await loadCheckout();

  return new Promise<'paid' | 'dismissed'>((resolve, reject) => {
    const rzp = new (window as any).Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: 'RTBI',
      description: `Invoice ${order.invoiceNumber}`,
      prefill: order.prefill,
      theme: { color: '#361C6A' },
      modal: { ondismiss: () => resolve('dismissed') },
      handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        try {
          await api(`/api/invoices/${invoiceId}/razorpay/verify`, 'POST', resp);
          await refreshFinanceFromServer();
          resolve('paid');
        } catch (e) {
          reject(e);
        }
      },
    });
    rzp.on('payment.failed', (r: any) => reject(new Error(r?.error?.description || 'The payment failed.')));
    rzp.open();
  });
}
