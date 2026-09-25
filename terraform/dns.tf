# =============================================================================
# DNS — var.domain_name points straight at the instance's Elastic IP.
# TLS is terminated on the instance by nginx with a Let's Encrypt certificate
# (DNS-01 via Route53, see user_data.sh.tpl); no load balancer.
# =============================================================================

data "aws_route53_zone" "this" {
  name = var.hosted_zone
}

resource "aws_route53_record" "app" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.domain_name
  type    = "A"
  ttl     = 300
  records = [aws_eip.this.public_ip]
}
