"""Prints JSON {subject, to, html, text} for an .eml file (decoded). Used by the email e2e suite."""
import sys, json, email
from email import policy
m = email.message_from_file(open(sys.argv[1], encoding='utf-8', errors='replace'), policy=policy.default)
html = text = ''
for part in m.walk():
    ct = part.get_content_type()
    if part.get_content_disposition() == 'attachment':
        continue
    if ct == 'text/html': html += part.get_content()
    elif ct == 'text/plain': text += part.get_content()
print(json.dumps({'subject': str(m['subject']), 'to': str(m['to']), 'html': html, 'text': text, 'attachments': [p.get_filename() for p in m.walk() if p.get_content_disposition() == 'attachment']}))
