# 📬 Deliverability

Hundreds of near-identical emails is what spam filters watch for. Work through this
checklist once with whoever manages your DNS.

- [ ] **SPF**: a TXT record that authorises Google to send, for example `v=spf1 include:_spf.google.com ~all`
- [ ] **DKIM**: enable it in Google Admin (Apps, Gmail, Authenticate email) and publish the key
- [ ] **DMARC**: start gentle, for example `v=DMARC1; p=none; rua=mailto:dmarc@example.com`
- [ ] **Test first**: send a preview to a Gmail and an Outlook address before the full send
- [ ] **Keep From on your domain**: do not send as an outside address
- [ ] **Real text in the body**: not only an image, and include a contact line
- [ ] **Warm up gently**: the defaults of 10 per batch and 60 seconds between batches spread 600 mails over about an hour

DKIM matters most. The service cannot configure any of this for you.
