# WhatsApp certificate sending

The app is ready to use Meta WhatsApp Cloud API. Your WhatsApp or WhatsApp Business phone app alone does not provide automatic bulk sending.

## Works immediately without an API connection

Certificates → Prepare all WhatsApp messages creates one private certificate message per eligible attendee. Open a message, click Open in WhatsApp, press Send yourself, then click Mark manually shared. Preparing a message or opening WhatsApp does not send it.

## Optional automatic sending setup

A person managing your Meta Business account must provide a WhatsApp Cloud API sender, the phone number ID, an access token with messaging permissions, and an approved utility template. Set these in Supabase → Edge Functions → Secrets, never in GitHub or website settings:

| Secret | Value |
|---|---|
| WHATSAPP_ACCESS_TOKEN | Your Meta system-user access token |
| WHATSAPP_PHONE_NUMBER_ID | The sender phone-number ID (not the actual phone number) |
| WHATSAPP_CERTIFICATE_TEMPLATE | Name of your approved certificate utility template |
| WHATSAPP_GRAPH_VERSION | A currently supported Graph API version, in vNN.N format |
| WHATSAPP_TEMPLATE_LANGUAGE | Template language code, e.g. en_US |

Use a plain text BODY template with exactly these three positional variables in this order (no media header, buttons or extra variables):

Dear {{1}}, your certificate of attendance for {{2}} is ready. Download it from your private link: {{3}}. Please keep this link private.

1 = attendee name; 2 = activity title; 3 = complete private certificate URL.

Meta must approve the template and allow sending from the selected business number; account billing or provider charges may apply. Event-message consent and a valid mobile number are required.

Redeploy the cpd function after configuring secrets, reopen the app and sign in. Settings → Messaging connections should show Connected. Send one certificate to a consenting attendee and check it arrives before using Send all certificates.

## Status meanings

- Prepared: staff must send manually.
- Waiting to send / Sending: queued for the connected service.
- Accepted by WhatsApp: Meta returned a message ID; this does not confirm recipient delivery.
- Not sent: a failure was returned; review its reason and retry.
- Sending uncertain: a response was lost or timed out; check before retrying to avoid duplicates.
- Manually shared: staff confirmed they sent it themselves.

Recipient delivery/read webhooks are not included in this update. The interface does not mark API acceptance as delivered. Failed messages require staff retry; refreshing the app does not repeatedly resend them. Bulk resend also does not duplicate a pending or uncertain request.

Official reference: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
Template parameters: https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/template/
