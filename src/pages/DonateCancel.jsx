import "../styles/public.css";

export default function DonateCancel() {
  return (
    <div className="public-container">
      <h1>Payment Canceled</h1>
      <p>Your transaction was not completed.</p>

      <a className="public-donate-btn" href="/">
        Return to Homepage
      </a>
    </div>
  );
}
