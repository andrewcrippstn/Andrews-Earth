---
name: chat-handover
description: Use when a conversation has become very long, after finishing a significant feature or fix, or when Claude is unsure about something settled earlier in the chat. Suggests starting a new chat and prepares a handover summary, a full checklist of files to bring across, and a consistent name for the next chat.
---

# Chat Handover

Long chats get heavier with every message because the whole conversation is re-read each time. This skill helps move to a fresh chat without losing anything.

## When to use

- A significant feature or fix has just been completed
- The conversation has become very long, with many rounds of revisions
- You are unsure about something settled earlier, or you notice you are repeating yourself or contradicting earlier decisions

## What to do

1. Pause and suggest starting a new chat. Explain briefly why.

2. Write a handover summary covering:
   - What we have built so far
   - Decisions made and the reasons for them
   - The current state of the work
   - Known issues or bugs
   - Next steps

3. Prepare a "files to bring" checklist. Go back through the whole conversation and cover BOTH:
   - Files Claude created: the latest version of every HTML, code, zip or document
   - Files the user uploaded: specs, PDFs, floor plans, CSV exports, screenshots, reference documents and any other attachments. Uploads do not carry over to a new chat.

   For each file:
   - Give its name and current version number
   - Say whether the new chat still needs it
   - Say whether it is already in project knowledge or needs to be re-uploaded
   - Flag any file whose latest version exists only in this chat, and output it in full so it can be saved and re-uploaded
   - Remind the user to remove older versions from project knowledge so they don't conflict

4. Use consistent version numbering:
   - Name files with the project and a version number, e.g. telco-earth-v12.html
   - Increase the number every time a new build is handed over
   - Never reuse a version number

5. Suggest a name for the next chat: the project name plus the next part number, e.g. "Telco Earth part 3".

6. Finish with a short suggested first message for the new chat that includes the summary, the files to attach, and the chat name.

## If unsure

If you are unsure about something settled earlier, say so plainly and suggest a fresh start rather than guessing.
