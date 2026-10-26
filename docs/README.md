# 📚 Documentation

| Guide | What it covers |
|---|---|
| [Setup](setup.md) | Install, Gmail App Password, first campaign, first payslip run, one screenshot per step |
| [Payslips](payslips.md) | The payslip workflow, Excel format, retention, AI matching and your data |
| [Configuration](configuration.md) | Every environment variable and its default |
| [Deployment](deployment.md) | A Linux server with Docker, and the AWS Terraform stack |
| [Deliverability](deliverability.md) | SPF, DKIM, DMARC and warm-up |
| [How it works](how-it-works.md) | Architecture, the send loop, atomic claims, known limits |
| [Troubleshooting](troubleshooting.md) | Symptoms first, then fixes |
| [FAQ](faq.md) | Short answers to common questions |

Diagrams and screenshots live in `assets/`. They are generated: `python3 tools/gen_diagram.py`
draws the diagrams and `make screenshots` retakes the screenshots.
