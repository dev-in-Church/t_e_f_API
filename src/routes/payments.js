const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');

const router = express.Router();

// M-Pesa STK Push
router.post('/mpesa/stkpush', [
  body('phone').notEmpty().withMessage('Phone number is required'),
  body('amount').isFloat({ min: 1 }).withMessage('Amount is required'),
  body('donation_id').isUUID().withMessage('Donation ID is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { phone, amount, donation_id } = req.body;

  try {
    // Format phone number (remove leading 0 or +254)
    let formattedPhone = phone.replace(/^(\+254|254|0)/, '254');
    
    // In production, you would:
    // 1. Get OAuth token from Safaricom
    // 2. Make STK Push request
    // 3. Store the checkout request ID
    
    // For now, we'll simulate the response
    const checkoutRequestId = `ws_CO_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Update donation with M-Pesa details
    await query(
      `UPDATE donations 
       SET mpesa_checkout_id = $1, updated_at = NOW() 
       WHERE id = $2`,
      [checkoutRequestId, donation_id]
    );

    // Log the payment attempt
    await query(
      `INSERT INTO payment_logs (donation_id, payment_method, request_data, status)
       VALUES ($1, 'mpesa', $2, 'initiated')`,
      [donation_id, JSON.stringify({ phone: formattedPhone, amount, checkoutRequestId })]
    );

    res.json({
      success: true,
      message: 'STK Push sent. Please check your phone.',
      checkoutRequestId,
    });
  } catch (error) {
    console.error('M-Pesa STK Push error:', error);
    res.status(500).json({ error: 'Failed to initiate M-Pesa payment' });
  }
});

// M-Pesa Callback (called by Safaricom)
router.post('/mpesa/callback', async (req, res) => {
  try {
    const { Body } = req.body;
    const { stkCallback } = Body;
    
    console.log('M-Pesa Callback received:', JSON.stringify(req.body));

    const checkoutRequestId = stkCallback.CheckoutRequestID;
    const resultCode = stkCallback.ResultCode;
    const resultDesc = stkCallback.ResultDesc;

    // Find the donation
    const donationResult = await query(
      'SELECT id FROM donations WHERE mpesa_checkout_id = $1',
      [checkoutRequestId]
    );

    if (donationResult.rows.length === 0) {
      console.error('Donation not found for checkout ID:', checkoutRequestId);
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const donationId = donationResult.rows[0].id;

    if (resultCode === 0) {
      // Payment successful
      const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
      const mpesaReceipt = callbackMetadata.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
      const transactionDate = callbackMetadata.find(i => i.Name === 'TransactionDate')?.Value;
      const phoneNumber = callbackMetadata.find(i => i.Name === 'PhoneNumber')?.Value;

      await query(
        `UPDATE donations 
         SET status = 'completed', 
             mpesa_receipt = $1, 
             paid_at = NOW(),
             updated_at = NOW() 
         WHERE id = $2`,
        [mpesaReceipt, donationId]
      );

      // Log successful payment
      await query(
        `INSERT INTO payment_logs (donation_id, payment_method, response_data, status)
         VALUES ($1, 'mpesa', $2, 'completed')`,
        [donationId, JSON.stringify({ mpesaReceipt, transactionDate, phoneNumber })]
      );
    } else {
      // Payment failed
      await query(
        `UPDATE donations SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [donationId]
      );

      await query(
        `INSERT INTO payment_logs (donation_id, payment_method, response_data, status)
         VALUES ($1, 'mpesa', $2, 'failed')`,
        [donationId, JSON.stringify({ resultCode, resultDesc })]
      );
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('M-Pesa Callback error:', error);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

// Create Stripe Payment Intent
router.post('/stripe/create-intent', [
  body('amount').isFloat({ min: 1 }),
  body('donation_id').isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { amount, donation_id, currency = 'kes' } = req.body;

  try {
    // In production, you would use Stripe SDK:
    // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    // const paymentIntent = await stripe.paymentIntents.create({
    //   amount: amount * 100, // Stripe uses cents
    //   currency,
    //   metadata: { donation_id },
    // });

    // Simulated response
    const clientSecret = `pi_${Date.now()}_secret_${Math.random().toString(36).substring(7)}`;

    await query(
      `UPDATE donations SET stripe_payment_intent = $1, updated_at = NOW() WHERE id = $2`,
      [clientSecret.split('_secret_')[0], donation_id]
    );

    res.json({
      clientSecret,
      amount,
      currency,
    });
  } catch (error) {
    console.error('Stripe Payment Intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// Stripe Webhook
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // In production, verify webhook signature:
    // const sig = req.headers['stripe-signature'];
    // const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    const event = req.body;

    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object;
        const donationId = paymentIntent.metadata.donation_id;

        await query(
          `UPDATE donations 
           SET status = 'completed', paid_at = NOW(), updated_at = NOW() 
           WHERE id = $1`,
          [donationId]
        );

        await query(
          `INSERT INTO payment_logs (donation_id, payment_method, response_data, status)
           VALUES ($1, 'card', $2, 'completed')`,
          [donationId, JSON.stringify(paymentIntent)]
        );
        break;

      case 'payment_intent.payment_failed':
        const failedPayment = event.data.object;
        const failedDonationId = failedPayment.metadata.donation_id;

        await query(
          `UPDATE donations SET status = 'failed', updated_at = NOW() WHERE id = $1`,
          [failedDonationId]
        );
        break;
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Stripe Webhook error:', error);
    res.status(400).json({ error: 'Webhook error' });
  }
});

// Check payment status
router.get('/status/:donationId', async (req, res) => {
  try {
    const result = await query(
      `SELECT status, payment_method, paid_at, mpesa_receipt 
       FROM donations WHERE id = $1`,
      [req.params.donationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    res.json({ payment: result.rows[0] });
  } catch (error) {
    console.error('Payment status error:', error);
    res.status(500).json({ error: 'Failed to get payment status' });
  }
});

module.exports = router;
