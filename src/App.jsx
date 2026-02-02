// src/App.jsx
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { CampaignProvider } from "./context/CampaignContext";

import Layout from "./components/Layout";
import ProtectedRoute from "./routes/ProtectedRoute";
import Login from "./pages/Login";

import DashboardHome from "./pages/DashboardHome";
import Campaigns from "./pages/Campaigns";
import CampaignDetail from "./pages/CampaignDetail";
import CampaignOverview from "./pages/CampaignOverview";
import EditCampaign from "./pages/EditCampaign";
import Teams from "./pages/Teams";
import TeamDetail from "./pages/TeamDetail";
import EditTeam from "./pages/EditTeam";
import Athletes from "./pages/Athletes";
import AthleteDetail from "./pages/AthleteDetail";
import EditAthlete from "./pages/EditAthlete";
import AddAthlete from "./pages/AddAthlete";
import DonationsList from "./pages/DonationsList";
import CampaignDonations from "./pages/CampaignDonations";
import AdminUsers from "./pages/AdminUsers";
import AdminInviteUser from "./pages/AdminInviteUser";
import AcceptInvite from "./pages/AcceptInvite";
import CoachInviteAthlete from "./pages/CoachInviteAthlete";
import JoinTeam from "./pages/JoinTeam";
import PublicCampaign from "./pages/PublicCampaign";
import DonateSuccess from "./pages/DonateSuccess";
import AdminFinancials from "./pages/AdminFinancials";
import Coaches from "./pages/Coaches";
import Donors from "./pages/Donations";
import AddDonor from "./pages/AddDonor";
import DonorDetail from "./pages/DonorDetail";
import Settings from "./pages/Settings";
import Messages from "./pages/Messages";

export default function App() {
  return (
    <AuthProvider>
      <CampaignProvider>
        {/* 🚨 NO BrowserRouter here */}
        <Routes>
  {/* Public */}
  <Route path="/login" element={<Login />} />
  <Route path="/accept-invite" element={<AcceptInvite />} />
  <Route path="/join/:code" element={<JoinTeam />} />
  <Route path="/join" element={<JoinTeam />} />
  <Route path="/donate/:campaignId/athlete/:athleteId" element={<PublicCampaign />} />
  <Route path="/donate/:campaignId" element={<PublicCampaign />} />
  <Route path="/donate-success" element={<DonateSuccess />} />
  <Route path="/admin/financials" element={<AdminFinancials />} />

  {/* === PROTECTED APP ROUTES === */}
  <Route element={<ProtectedRoute />}>
    <Route element={<Layout />}>
      {/* Dashboard */}
      <Route index element={<DashboardHome />} />

      {/* Campaigns */}
      <Route path="campaigns" element={<Campaigns />} />
      <Route path="campaigns/:campaignId" element={<CampaignDetail />} />
      <Route path="campaigns/:campaignId/edit" element={<EditCampaign />} />
      <Route
        path="campaigns/:campaignId/overview"
        element={<CampaignOverview />}
      />
      <Route
        path="campaigns/:campaignId/donations"
        element={<CampaignDonations />}
      />

      {/* Teams */}
      <Route path="teams" element={<Teams />} />
      <Route path="teams/:teamId" element={<TeamDetail />} />
      <Route path="teams/:teamId/edit" element={<EditTeam />} />

      {/* Coaches */}
      <Route path="coaches" element={<Coaches />} />

      {/* Athletes */}
      <Route path="athletes" element={<Athletes />} />
      <Route path="athletes/new" element={<AddAthlete />} />
      <Route path="athletes/add" element={<AddAthlete />} />
      <Route path="athletes/:athleteId" element={<AthleteDetail />} />
      <Route path="athletes/:athleteId/edit" element={<EditAthlete />} />

      {/* Donations */}
      <Route path="donations" element={<DonationsList />} />

      {/* Donors */}
      <Route path="donors" element={<Donors />} />
      <Route path="donors/new" element={<AddDonor />} />
      <Route path="donors/:donorId" element={<DonorDetail />} />

      {/* Messages */}
      <Route path="messages" element={<Messages />} />

      {/* Settings */}
      <Route path="settings" element={<Settings />} />

      {/* Admin */}
      <Route path="admin/users" element={<AdminUsers />} />
      <Route path="admin/invite" element={<AdminInviteUser />} />
      <Route path="coach/invite" element={<CoachInviteAthlete />} />
    </Route>
  </Route>

  {/* Catch-all */}
  <Route path="*" element={<Navigate to="/login" replace />} />
</Routes>
      </CampaignProvider>
    </AuthProvider>
  );
}
