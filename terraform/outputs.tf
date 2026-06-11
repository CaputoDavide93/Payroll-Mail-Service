output "public_ip" {
  description = "Static public IP of the instance (Elastic IP)"
  value       = aws_eip.this.public_ip
}

output "app_url" {
  description = "URL to open in your browser"
  value       = "http://${aws_eip.this.public_ip}:3000"
}

output "ssh_command" {
  description = "SSH into the instance"
  value       = "ssh -i terraform/payroll-mail-service.pem ec2-user@${aws_eip.this.public_ip}"
}

output "bootstrap_log" {
  description = "Watch the startup log on the instance"
  value       = "ssh -i terraform/payroll-mail-service.pem ec2-user@${aws_eip.this.public_ip} 'sudo tail -f /var/log/user-data.log'"
}

output "instance_id" {
  value = aws_instance.this.id
}
