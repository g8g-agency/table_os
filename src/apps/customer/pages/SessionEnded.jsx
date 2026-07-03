import React, { useState } from 'react';

export default function SessionEndedPage() {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  const searchParams = new URLSearchParams(window.location.search);
  const orderId = searchParams.get('orderId');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!rating) {
      setError('Please select a rating before submitting.');
      return;
    }
    
    setError(null);
    try {
      const token = localStorage.getItem('qr_session_token');
      
      const res = await fetch('/api/v1/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-qr-session-token': token || ''
        },
        body: JSON.stringify({
          orderId,
          rating,
          comment
        })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to submit review');
      }
      
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', backgroundColor: '#0a0a0a', minHeight: '100vh', color: 'white' }}>
      <div style={{ fontSize: 64 }}>🙏</div>
      <h1 style={{ fontSize: 24, fontWeight: 'bold', margin: '16px 0' }}>Thank you!</h1>
      <p style={{ marginBottom: 8 }}>Your payment is complete.</p>
      <p style={{ color: '#8B949E', fontSize: 14, marginBottom: 32 }}>
        Please scan the QR code again if you'd like to order more.
      </p>

      {orderId && !submitted && (
        <div style={{ background: '#1a1a1a', padding: '24px', borderRadius: '12px', textAlign: 'left', border: '1px solid #333' }}>
          <h2 style={{ fontSize: 18, marginBottom: '16px', fontWeight: 'bold' }}>How was your experience?</h2>
          
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', justifyContent: 'center' }}>
            {[1, 2, 3, 4, 5].map(star => (
              <button 
                key={star}
                type="button"
                onClick={() => setRating(star)}
                style={{
                  background: 'none', border: 'none', fontSize: '32px', cursor: 'pointer',
                  color: star <= rating ? '#F0883E' : '#444'
                }}
              >
                ★
              </button>
            ))}
          </div>

          <textarea 
            placeholder="Tell us what you liked or how we can improve..."
            value={comment}
            onChange={e => setComment(e.target.value)}
            style={{
              width: '100%',
              minHeight: '80px',
              background: '#222',
              border: '1px solid #444',
              borderRadius: '8px',
              padding: '12px',
              color: 'white',
              marginBottom: '16px'
            }}
          />

          {error && <div style={{ color: '#F87171', fontSize: 14, marginBottom: '16px' }}>{error}</div>}

          <button 
            onClick={handleSubmit}
            style={{
              width: '100%', padding: '12px', background: '#F0883E', color: 'white', 
              border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer'
            }}
          >
            Submit Review
          </button>
        </div>
      )}

      {submitted && (
        <div style={{ background: '#F0FDF4', color: '#166534', padding: '16px', borderRadius: '12px', border: '1px solid #BBF7D0' }}>
          <p style={{ fontWeight: 'bold', marginBottom: '4px' }}>Review Submitted!</p>
          <p style={{ fontSize: 14 }}>Thank you for your feedback.</p>
        </div>
      )}
    </div>
  );
}
