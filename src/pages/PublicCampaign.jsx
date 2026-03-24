import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase/config";
import "../styles/public-campaign.css";
import safeImageURL from "../utils/safeImage";
import {
  FaEnvelope,
  FaFacebookF,
  FaInstagram,
  FaLink,
  FaTiktok,
  FaXTwitter,
} from "react-icons/fa6";

const DONATION_PRESETS = [25, 50, 100, 250];

function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString()}`;
}

function formatDate(value) {
  if (!value?.toDate) return "Just now";
  return value.toDate().toLocaleString();
}

function formatShortDate(value) {
  if (!value) return "TBD";
  if (value?.toDate) {
    return value.toDate().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
    return value;
  }
  return "TBD";
}

function getYoutubeEmbed(url) {
  if (!url || typeof url !== "string") return "";
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/
  );
  if (!match) return "";
  return `https://www.youtube.com/embed/${match[1]}`;
}

function toDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value?.toDate) return value.toDate();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function startOfDay(value) {
  if (!value) return null;
  const date = toDateValue(value);
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
}

function getCountdownParts(startDate, endDate) {
  const start = startOfDay(startDate);
  const end = startOfDay(endDate);

  if (!end) {
    return {
      days: "0",
      hours: "0",
      minutes: "0",
      seconds: "0",
      label: "Time left to donate",
    };
  }

  const endMidnight = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  const now = Date.now();
  const startTime = start ? start.getTime() : null;

  if (startTime && now < startTime) {
    const diffMs = Math.max(0, startTime - now);
    const totalSeconds = Math.floor(diffMs / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    const seconds = totalSeconds % 60;
    return {
      days: String(days),
      hours: String(hours).padStart(2, "0"),
      minutes: String(minutes).padStart(2, "0"),
      seconds: String(seconds).padStart(2, "0"),
      label: "Starts in",
    };
  }

  if (now >= endMidnight.getTime()) {
    return {
      days: "0",
      hours: "0",
      minutes: "0",
      seconds: "0",
      label: "Campaign ended",
    };
  }

  const diffMs = Math.max(0, endMidnight.getTime() - now);
  const totalSeconds = Math.floor(diffMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;

  return {
    days: String(days),
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0"),
    label: "Time left to donate",
  };
}

export default function PublicCampaign() {
  const { campaignId, athleteId } = useParams();
  const isAthletePage = Boolean(athleteId);

  const [campaign, setCampaign] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [athlete, setAthlete] = useState(null);
  const [campaignAthletes, setCampaignAthletes] = useState([]);

  const [amountDollars, setAmountDollars] = useState("250");
  const [selectedAmountOption, setSelectedAmountOption] = useState("250");
  const [customAmount, setCustomAmount] = useState("");
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [donorMessage, setDonorMessage] = useState("");
  const [hideName, setHideName] = useState(false);
  const [comments, setComments] = useState([]);
  const [publicDonors, setPublicDonors] = useState([]);
  const [countdown, setCountdown] = useState({
    days: "0",
    hours: "0",
    minutes: "0",
    seconds: "0",
    label: "Time left",
  });

  // ---------------------------------------------------
  // Load campaign (public read)
  // ---------------------------------------------------
  useEffect(() => {
    async function loadCampaign() {
      try {
        setPageLoading(true);

        const ref = doc(db, "campaigns", campaignId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setCampaign(null);
          return;
        }

        setCampaign({ id: snap.id, ...snap.data() });
      } catch (err) {
        console.error("Failed to load campaign:", err);
        setCampaign(null);
      } finally {
        setPageLoading(false);
      }
    }

    if (campaignId) {
      loadCampaign();
    }
  }, [campaignId]);

  // ---------------------------------------------------
  // Load athlete (public read, optional)
  // ---------------------------------------------------
  useEffect(() => {
    async function loadAthlete() {
      if (!athleteId) {
        setAthlete(null);
        return;
      }

      try {
        const ref = doc(db, "athletes", athleteId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setAthlete(null);
          return;
        }

        const data = { id: snap.id, ...snap.data() };
        if (data.campaignId && data.campaignId !== campaignId) {
          setAthlete(null);
          return;
        }

        setAthlete(data);
      } catch (err) {
        console.error("Failed to load athlete:", err);
        setAthlete(null);
      }
    }

    loadAthlete();
  }, [athleteId, campaignId]);

  useEffect(() => {
    async function loadCampaignAthletes() {
      if (!campaignId || campaign?.isPublic === false || isAthletePage) {
        setCampaignAthletes([]);
        return;
      }

      try {
        const athletesQuery = query(
          collection(db, "athletes"),
          where("campaignId", "==", campaignId),
          limit(12)
        );
        const snap = await getDocs(athletesQuery);
        const next = snap.docs.map((entry) => ({
          id: entry.id,
          ...entry.data(),
        }));
        setCampaignAthletes(next);
      } catch (err) {
        console.error("Failed to load campaign athletes:", err);
        setCampaignAthletes([]);
      }
    }

    loadCampaignAthletes();
  }, [campaignId, campaign?.isPublic, isAthletePage]);

  // ---------------------------------------------------
  // Load comments (public read)
  // ---------------------------------------------------
  useEffect(() => {
    if (!campaignId || campaign?.isPublic === false) {
      setComments([]);
      return;
    }

    const commentsRef = collection(db, "campaigns", campaignId, "comments");
    const commentsQuery = query(
      commentsRef,
      orderBy("createdAt", "desc"),
      limit(50)
    );

    const unsubscribe = onSnapshot(
      commentsQuery,
      (snap) => {
        const next = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setComments(next);
      },
      (err) => {
        console.error("Failed to load comments:", err);
        setComments([]);
      }
    );

    return () => unsubscribe();
  }, [campaignId, campaign?.isPublic, isAthletePage]);

  // ---------------------------------------------------
  // Load public donors (public read)
  // ---------------------------------------------------
  useEffect(() => {
    if (!campaignId || campaign?.isPublic === false) {
      setPublicDonors([]);
      return;
    }

    const donorsRef = collection(db, "campaigns", campaignId, "public_donors");
    const donorsQuery = query(donorsRef, orderBy("createdAt", "desc"), limit(20));

    const unsubscribe = onSnapshot(
      donorsQuery,
      (snap) => {
        const next = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setPublicDonors(next);
      },
      (err) => {
        console.error("Failed to load donors:", err);
        setPublicDonors([]);
      }
    );

    return () => unsubscribe();
  }, [campaignId, campaign?.isPublic, athleteId]);

  const campaignVideo = useMemo(
    () => getYoutubeEmbed(campaign?.videoUrl || campaign?.youtubeUrl || ""),
    [campaign?.videoUrl, campaign?.youtubeUrl]
  );

  useEffect(() => {
    const startDateValue = campaign?.startDate;
    const endDateValue = campaign?.endDate;
    if (!endDateValue) {
      setCountdown(getCountdownParts(startDateValue, null));
      return;
    }

    setCountdown(getCountdownParts(startDateValue, endDateValue));

    const timer = setInterval(() => {
      setCountdown(getCountdownParts(startDateValue, endDateValue));
    }, 1000);

    return () => clearInterval(timer);
  }, [campaign?.endDate, campaign?.startDate]);

  // ---------------------------------------------------
  // Page loading state
  // ---------------------------------------------------
  if (pageLoading) {
    return (
      <div className="p-8 text-center">
        <p>Loading campaign...</p>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-xl font-semibold">Campaign not found</h1>
      </div>
    );
  }

  const goalAmount = Number(campaign.goalAmount || 0);
  const totalRaisedCents = Number(
    campaign.publicTotalRaisedCents ?? campaign.totalRaisedCents ?? 0
  );
  const totalRaisedDollars = totalRaisedCents / 100;
  const percentRaised = goalAmount
    ? Math.min(100, Math.round((totalRaisedDollars / goalAmount) * 100))
    : 0;
  const donorCount = Number(
    campaign.publicDonorCount ?? campaign.donorCount ?? publicDonors.length
  );
  const remainingChars = Math.max(0, 500 - donorMessage.length);
  const showAthlete = isAthletePage && !!athlete;
  const athleteRaisedCents = showAthlete
    ? Number(athlete.publicTotalRaisedCents || 0)
    : 0;
  const athleteRaisedDollars = athleteRaisedCents / 100;
  const athleteGoalAmount = Number(athlete?.goal || 0);
  const athletePercent = athleteGoalAmount
    ? Math.min(100, Math.round((athleteRaisedDollars / athleteGoalAmount) * 100))
    : null;
  const teamProgressWidth = `${Math.max(0, Math.min(100, percentRaised))}%`;
  const athleteProgressWidth =
    athletePercent === null ? "0%" : `${Math.max(0, Math.min(100, athletePercent))}%`;
  const selectedAmountNumber = Number(amountDollars || 0);
  const donateButtonLabel =
    Number.isFinite(selectedAmountNumber) && selectedAmountNumber > 0
      ? `Donate ${formatCurrency(selectedAmountNumber)}`
      : "Donate";
  const supportTitle = showAthlete
    ? `Help ${athlete.name || "this athlete"} reach the season goal`
    : `Help ${campaign.teamName || "this team"} reach the fundraising goal`;
  const showDefaultWelcomeMessage = campaign?.showDefaultWelcomeMessage !== false;
  const welcomeLine = `${
    campaign.teamName || "This team"
  } family, friends, and fans - Thank you so much for taking the time to view our fundraiser page.`;
  const supportSubtitle = showAthlete
    ? `${athlete.name || "This athlete"} is fundraising for ${
        campaign.teamName || "the team"
      }. Your gift helps cover season costs, travel, equipment, and team needs.`
    : `Every donation helps ${campaign.teamName || "this group"} cover season costs, equipment, travel, and program essentials.`;
  const donorProofText =
    donorCount === 1 ? "1 donor has already stepped up." : `${donorCount} donors have already stepped up.`;
  const impactItems = [
    showAthlete
      ? `Supports ${athlete.name || "the athlete"} and ${campaign.teamName || "the team"}`
      : `Supports ${campaign.teamName || "the team"} this season`,
    "Secure checkout and instant email receipt",
    campaign.endDate ? `Giving window ends ${formatShortDate(campaign.endDate)}` : "Giving is open now",
  ];
  const featuredAthletes = campaignAthletes
    .slice()
    .sort(
      (a, b) =>
        Number(b.publicTotalRaisedCents || 0) - Number(a.publicTotalRaisedCents || 0)
    )
    .slice(0, 6);
  const shareLink = (() => {
    if (typeof window === "undefined") return "";
    if (showAthlete) {
      return `${window.location.origin}/donate/${campaign.id}/athlete/${athlete.id}`;
    }
    return `${window.location.origin}/donate/${campaign.id}`;
  })();
  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------
  return (
    <div className="public-shell">
      <div className="public-frame">
        <section className="public-hero">
          <div className="public-hero-inner">
            <div className="flex items-center gap-4 min-w-0">
              {campaign.imageURL && (
                <img
                  src={campaign.imageURL}
                  alt={campaign.teamName || campaign.name || "Team logo"}
                  className="h-12 w-12 rounded-xl object-contain border border-slate-200 bg-white"
                />
              )}
	              <div className="min-w-0">
	                <div className="public-eyebrow">
	                  {campaign.teamName || "Community Fundraiser"}
	                </div>
	                {showDefaultWelcomeMessage && (
	                  <p className="public-welcome-line">{welcomeLine}</p>
	                )}
	                <h1 className="public-title">{campaign.name}</h1>
	              </div>
	            </div>

	            <div className="public-hero-grid">
	              <div className="public-card public-card-soft public-donate-card">
	                <h2>Make Your Gift</h2>
	                <p className="public-card-lead">
	                  Choose an amount and check out in less than a minute.
	                </p>
	                {showAthlete && (
	                  <div
	                    className="public-list-meta"
                    style={{ marginBottom: "8px" }}
                  >
                    Supporting {athlete.name || "this athlete"}
                  </div>
                )}
                <div className="public-form">
                  <div>
	                    <div className="public-list-meta" style={{ marginBottom: "8px" }}>
	                      Choose amount
	                    </div>
	                    <div className="public-amount-grid">
                      {DONATION_PRESETS.map((amount) => {
                        const key = String(amount);
                        const isActive = selectedAmountOption === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => {
                              setSelectedAmountOption(key);
                              setAmountDollars(key);
                            }}
                            className={`public-amount-chip ${isActive ? "is-active" : ""}`}
                          >
                            ${amount}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedAmountOption("custom");
                          if (customAmount.trim()) {
                            setAmountDollars(customAmount.trim());
                          }
                        }}
                        className={`public-amount-chip ${selectedAmountOption === "custom" ? "is-active" : ""}`}
                      >
                        Custom
                      </button>
                    </div>
                  </div>

                  {selectedAmountOption === "custom" && (
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={customAmount}
                      onChange={(e) => {
                        const next = e.target.value;
                        setCustomAmount(next);
                        setAmountDollars(next);
                      }}
                      className="public-input"
                      placeholder="Enter custom amount (USD)"
                    />
                  )}

                  <input
                    type="text"
                    value={donorName}
                    onChange={(e) => setDonorName(e.target.value)}
                    className="public-input"
                    placeholder="Your name (optional)"
                  />

                  <input
                    type="email"
                    value={donorEmail}
                    onChange={(e) => setDonorEmail(e.target.value)}
                    className="public-input"
                    placeholder="Email for receipt (optional)"
                  />

                  <label className="public-list-meta">
                    <input
                      type="checkbox"
                      checked={hideName}
                      onChange={(e) => setHideName(e.target.checked)}
                      style={{ marginRight: "8px" }}
                    />
                    Do not show my name with my comment
                  </label>

                  <textarea
                    value={donorMessage}
                    onChange={(e) =>
                      setDonorMessage(e.target.value.slice(0, 500))
                    }
                    className="public-textarea"
                    placeholder="Leave a message of support (optional)"
                    maxLength={500}
                  />
                  <div className="public-list-meta">
                    {remainingChars} characters left
                  </div>

	                  <button
	                    onClick={async () => {
                      try {
                        setCheckoutLoading(true);

                        const amountCents = Math.round(
                          Number(amountDollars) * 100
                        );

                        if (!Number.isFinite(amountCents) || amountCents < 100) {
                          alert("Please enter a valid donation amount.");
                          return;
                        }

                        const fn = httpsCallable(functions, "createCheckoutSession");
                        // Preserve exact return path while Stripe/webhook finalization completes.
                        const pendingDonateReturnPath = isAthletePage
                          ? `/donate/${campaign.id}/athlete/${athleteId}`
                          : `/donate/${campaign.id}`;
                        sessionStorage.setItem(
                          "pendingDonateReturnPath",
                          pendingDonateReturnPath
                        );

                        const res = await fn({
                          campaignId: campaign.id,
                          amountCents,
                          donorName,
                          donorEmail,
                          donorMessage,
                          donorAnonymous: hideName,
                          athleteId: isAthletePage ? athleteId : "",
                        });

                        if (!res.data?.url) {
                          throw new Error("No checkout URL returned.");
                        }

                        window.location.assign(res.data.url);
                      } catch (err) {
                        console.error("Checkout error:", err);
                        alert("Unable to start checkout. Please try again.");
                      } finally {
                        setCheckoutLoading(false);
                      }
	                    }}
	                    disabled={checkoutLoading}
	                    className="public-button"
	                  >
	                    {checkoutLoading ? "Redirecting..." : donateButtonLabel}
	                  </button>
	                  <div className="public-list-meta">
	                    Secure checkout by Stripe. Use your email if you want a receipt.
	                  </div>

	                  <div>
	                    <div
                      className="public-list-meta"
                      style={{ marginBottom: "8px" }}
                    >
                      Share this campaign
                    </div>
                    <div className="public-share">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(shareLink).catch(() => {});
                          alert("Link copied!");
                        }}
                      >
                        <FaLink /> Copy link
                      </button>
                      <a
                        href={`mailto:?subject=Support ${encodeURIComponent(
                          campaign.name || "our fundraiser"
                        )}&body=${encodeURIComponent(shareLink)}`}
                      >
                        <FaEnvelope /> Email
                      </a>
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
                          shareLink
                        )}`}
                      >
                        <FaFacebookF /> Facebook
                      </a>
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(
                          shareLink
                        )}&text=${encodeURIComponent(
                          campaign.name || "Support this fundraiser"
                        )}`}
                      >
                        <FaXTwitter /> X
                      </a>
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={`https://www.instagram.com/?url=${encodeURIComponent(
                          shareLink
                        )}`}
                      >
                        <FaInstagram /> Instagram
                      </a>
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href="https://www.tiktok.com/upload"
                      >
                        <FaTiktok /> TikTok
                      </a>
                    </div>
                  </div>
                </div>
              </div>

	              <div className="public-card">
	                <h2>Goal Progress</h2>
	                <div className="public-proof-band">
	                  <strong>{formatCurrency(totalRaisedDollars)}</strong> raised so far.
	                  <span>{donorProofText}</span>
	                </div>

	                <div className="public-goal-block">
                  <div className="public-goal-row">
                    <span className="public-goal-label">Team Goal</span>
                    <span className="public-goal-value">
                      {formatCurrency(totalRaisedDollars)} / {formatCurrency(goalAmount)}
                    </span>
                  </div>
                  <div className="public-progress-track">
                    <div
                      className="public-progress-fill"
                      style={{ width: teamProgressWidth }}
                    />
                  </div>
                  <div className="public-list-meta">{percentRaised}% funded</div>
                </div>

                {showAthlete && (
                  <div className="public-goal-block">
                    <div className="public-goal-row">
                      <span className="public-goal-label">Personal Goal</span>
                      <span className="public-goal-value">
                        {formatCurrency(athleteRaisedDollars)} /{" "}
                        {athleteGoalAmount
                          ? formatCurrency(athleteGoalAmount)
                          : "Not set"}
                      </span>
                    </div>
                    <div className="public-progress-track">
                      <div
                        className="public-progress-fill"
                        style={{ width: athleteProgressWidth }}
                      />
                    </div>
                    <div className="public-list-meta">
                      {athletePercent === null ? "No personal goal yet" : `${athletePercent}% funded`}
                    </div>
                  </div>
                )}
              </div>

              {showAthlete && (
                <div className="public-card public-card-soft">
                  <div className="flex items-center gap-3">
                    <img
                      src={safeImageURL(athlete.photoURL)}
                      alt={athlete.name || "Athlete"}
                      className="h-14 w-14 rounded-full object-cover border border-slate-700/40"
                    />
                    <div>
                      <div className="text-lg font-semibold">
                        {athlete.name || "Athlete"}
                      </div>
                      <div className="public-list-meta">
                        {campaign.teamName || "Team supporter"}
                      </div>
                    </div>
                  </div>
                  <p className="public-muted" style={{ marginTop: "12px" }}>
                    {athlete.bio || "Supporting this season with the team."}
                  </p>
                  <div className="public-list-meta" style={{ marginTop: "12px" }}>
                    Personal goal:{" "}
                    {athleteGoalAmount
                      ? formatCurrency(athleteGoalAmount)
                      : "Optional"}
                  </div>
                  <div className="public-list-meta">
                    Raised: {formatCurrency(athleteRaisedDollars)}
                    {athletePercent !== null && ` > ${athletePercent}%`}
                  </div>
                </div>
              )}

	              <div className="public-card public-card-soft">
	                <div className="public-list-meta">Campaign Snapshot</div>
	                <div className="public-metric-value">{donorCount}</div>
	                <div className="public-list-meta">
	                  {campaign.teamNames?.length ? "Teams involved" : "Supporters so far"}
	                </div>
	                <div className="public-muted">
	                  {campaign.teamNames?.slice(0, 3).join(", ") || "Open to all"}
                </div>
                <div className="public-list-meta" style={{ marginTop: "8px" }}>
                  Start Date: {formatShortDate(campaign.startDate)}
                </div>
                <div className="public-list-meta">
                  End Date: {formatShortDate(campaign.endDate)}
                </div>
                <div className="public-list-meta" style={{ marginTop: "8px" }}>
                  <span className="public-countdown-label">
                    {countdown.label}
                  </span>
                  : {countdown.days}d {countdown.hours}h {countdown.minutes}m{" "}
                  {countdown.seconds}s
                </div>
              </div>
            </div>
          </div>
        </section>

	        <div className="public-columns">
	          <section className="public-section">
	            <h2>{showAthlete ? "Athlete Story" : "Campaign Story"}</h2>
	            {campaignVideo ? (
              <div className="public-video">
                <iframe
                  src={campaignVideo}
                  title={`${campaign.name} video`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="public-muted">
                Add a YouTube link to `videoUrl` on this campaign to show a video
                here.
              </div>
            )}
	            <p className="public-subtitle" style={{ marginTop: "16px" }}>
	              {showAthlete
	                ? athlete?.bio ||
	                  campaign.description ||
	                  "Your support directly helps this athlete contribute to the team and cover season costs."
	                : campaign.description ||
	                  "Your support directly helps the team cover their season costs and keeps this program thriving."}
	            </p>
	            <div className="public-impact-grid">
	              {impactItems.map((item) => (
	                <div key={item} className="public-impact-item">
	                  {item}
	                </div>
	              ))}
	            </div>
	          </section>
	        </div>

	        {!showAthlete && featuredAthletes.length > 0 && (
	          <div className="public-columns">
	            <section className="public-section">
	              <div className="public-section-header">
	                <div>
	                  <h2>Meet the Team</h2>
	                  <p className="public-muted">
	                    Donors can support the full program or choose a specific athlete page.
	                  </p>
	                </div>
	              </div>
	              <div className="public-athlete-grid">
	                {featuredAthletes.map((entry) => {
	                  const entryGoal = Number(entry.goal || entry.personalGoal || 0);
	                  const entryRaised = Number(entry.publicTotalRaisedCents || 0) / 100;
	                  const entryPercent =
	                    entryGoal > 0
	                      ? Math.max(0, Math.min(100, Math.round((entryRaised / entryGoal) * 100)))
	                      : null;
	                  return (
	                    <a
	                      key={entry.id}
	                      href={`/donate/${campaign.id}/athlete/${entry.id}`}
	                      className="public-athlete-card"
	                    >
	                      <img
	                        src={safeImageURL(entry.photoURL)}
	                        alt={entry.name || entry.displayName || "Athlete"}
	                        className="public-athlete-avatar"
	                      />
	                      <div className="public-athlete-copy">
	                        <div className="public-athlete-name">
	                          {entry.name || entry.displayName || "Athlete"}
	                        </div>
	                        <div className="public-list-meta">
	                          {entryGoal > 0
	                            ? `${formatCurrency(entryRaised)} of ${formatCurrency(entryGoal)}`
	                            : `${formatCurrency(entryRaised)} raised`}
	                        </div>
	                        {entryPercent !== null && (
	                          <>
	                            <div className="public-progress-track public-athlete-track">
	                              <div
	                                className="public-progress-fill"
	                                style={{ width: `${entryPercent}%` }}
	                              />
	                            </div>
	                            <div className="public-list-meta">{entryPercent}% of personal goal</div>
	                          </>
	                        )}
	                      </div>
	                      <span className="public-athlete-link">View athlete page</span>
	                    </a>
	                  );
	                })}
	              </div>
	            </section>
	          </div>
	        )}

	        <div className="public-columns">
          <section className="public-section">
            <h2>{showAthlete ? "Supporters" : "Recent Donors"}</h2>
            {publicDonors.length === 0 ? (
              <p className="public-muted">
                {showAthlete ? "No supporters yet." : "No donations yet."}
              </p>
            ) : (
              <div className="public-list">
                {publicDonors.map((donor) => (
                  <div key={donor.id} className="public-list-item">
                    <div>
                      <div>{donor.displayName || "Anonymous"}</div>
                      <div className="public-list-meta">
                        {formatDate(donor.createdAt)}
                      </div>
                    </div>
                    <div>{formatCurrency((donor.amountCents || 0) / 100)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="public-section">
            <h2>
              {comments.length} Comment{comments.length === 1 ? "" : "s"}
            </h2>
            {comments.length === 0 ? (
              <p className="public-muted">
                No comments yet. Leave a message with your donation.
              </p>
            ) : (
              <div className="public-list">
                {comments.map((comment) => (
                  <div key={comment.id} className="public-list-item">
                    <div>
                      <div>{comment.displayName || "Anonymous"}</div>
                      <div className="public-list-meta">
                        {formatDate(comment.createdAt)}
                      </div>
                      {comment.message && (
                        <div style={{ marginTop: "6px" }}>
                          {comment.message}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
