# Privacy Policy

**1111 Learn** -- Web App
**Data Controller:** 11:11 Philosopher's Group
**Last Updated:** 2026-03-24

---

## 1. Overview

1111 Learn is a multi-platform learning app that helps learners build their professional portfolio through AI-guided courses. This privacy policy explains what data is collected, how it is used, and your rights regarding that data.

**In short:** your learning data stays on your device by default. No telemetry is collected. Optional cloud sync (via sign-in) stores your learning data on our servers for cross-device access.

## 2. Data Stored Locally (Never Shared)

All core learning data is stored entirely on your device in a local SQLite database (persisted via IndexedDB) and IndexedDB for screenshots. This data never leaves your browser unless you sign in to sync.

| Data | Storage | Purpose |
|------|---------|---------|
| Your name and personal statement (entered at onboarding) | SQLite | Create your initial learner profile and personalize the experience |
| Course progress and activity history | SQLite | Track your learning journey |
| Conversations and messages | SQLite | Persist chat history with AI agents |
| Screenshots of your work | IndexedDB | AI assessment of your drafts |
| Learner profile (strengths, weaknesses, preferences, goal) | SQLite | Personalize future activities and course plans |
| Your Anthropic API key | SQLite | Authenticate API calls to Anthropic |
| Settings and preferences | SQLite | Remember your configuration |

We have no access to this data. It exists only on your device.

## 3. Anthropic API Calls

The extension sends requests to the Anthropic API (api.anthropic.com) using **your own API key** (or via the learn-service Bedrock proxy when signed in) to power the AI agents. These API calls include course context, activity instructions, learner profile data, and screenshots for assessment.

When using your own key, these calls are a direct relationship between you and Anthropic, governed by [Anthropic's privacy policy](https://www.anthropic.com/privacy) and terms of service. 11:11 Philosopher's Group does not have access to your API key or the content of these API calls.

## 4. No Telemetry

1111 Learn does not collect any telemetry, analytics, or usage data. No data is sent to any third-party analytics service.

## 5. Optional Cloud Sync

### 5.1 What Cloud Sync Does

You may optionally sign in to a learn-service account (provided by your administrator via invite) to sync learning data across devices. Cloud sync is **off by default** and is not required to use the extension.

### 5.2 What Is Synced

When signed in, the following data is synced to our server:

| Data | Purpose |
|------|---------|
| Learner profile (strengths, weaknesses, preferences, goal) | Restore your profile on another device |
| Learner profile summary | Restore your profile display |
| Preferences (name) | Personalization across devices |
| Course progress (activity history, drafts metadata, scores) | Continue courses on another device |
| Work products (completed course references) | Portfolio across devices |

### 5.3 What Is Never Synced

| Data | Why |
|------|-----|
| Screenshots | Too large; stored only in local IndexedDB |
| Your Anthropic API key | Security; stored only locally (unless admin-assigned via the service) |

### 5.4 Authentication Data

When you sign in, the extension stores JWT tokens locally to maintain your session:

- **Access token** (expires after 15 minutes, refreshed automatically)
- **Refresh token** (expires after 30 days, rotated on each use)
- **User object** (email, name, role)

These are stored in the local SQLite database and cleared on sign-out.

### 5.5 Cloud Data Storage

- **Server:** sync data is stored in AWS DynamoDB in the us-east-2 (Ohio) region.
- **Encryption:** all data is encrypted in transit (TLS) and at rest (AWS-managed encryption).
- **Access:** only 11:11 Philosopher's Group administrators can manage user accounts and data.
- **Deletion:** signing out removes local tokens. To delete cloud data, contact your administrator or use the contact methods in Section 8.

## 6. Your Rights

Under the GDPR and similar privacy regulations, you have the following rights:

| Right | How to exercise it |
|-------|-------------------|
| **Right to be informed** | This privacy policy provides full transparency about our data practices |
| **Right of access** | Contact us to request a copy of any data associated with your account |
| **Right to rectification** | Contact us if you believe collected data is inaccurate |
| **Right to erasure** | Contact us to request deletion of your cloud data |
| **Right to data portability** | All data is stored locally on your device and can be exported |

## 7. Children's Privacy

1111 Learn is an educational tool. We do not knowingly collect personal information from children under 13. No telemetry or analytics data is collected from any user.

## 8. Changes to This Policy

We may update this privacy policy from time to time. Changes will be reflected in this document with an updated "Last Updated" date.

## 9. Contact

If you have questions, concerns, or requests regarding your data or this privacy policy:

- **Email:** [1111@philosophers.group](mailto:1111@philosophers.group)
- **GitHub:** [Open an issue](https://github.com/1111philo/learn/issues) on our repository
- **Organization:** 11:11 Philosopher's Group -- [philosophers.group](https://philosophers.group)
