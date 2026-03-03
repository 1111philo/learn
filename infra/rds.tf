resource "aws_db_subnet_group" "main" {
  name       = "${var.app_name}-db-subnets"
  subnet_ids = [aws_subnet.public_a.id, aws_subnet.public_b.id]

  tags = { Name = "${var.app_name}-db-subnets" }
}

resource "aws_security_group" "rds" {
  name        = "${var.app_name}-rds-sg"
  description = "Allow PostgreSQL access"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "PostgreSQL from anywhere (locked down by password auth)"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.app_name}-rds-sg" }
}

resource "aws_db_instance" "main" {
  identifier     = "${var.app_name}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t3.micro"

  allocated_storage = 20
  storage_type      = "gp3"

  db_name  = var.app_name
  username = var.app_name
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = true

  skip_final_snapshot = true
  apply_immediately   = true

  tags = { Name = "${var.app_name}-db" }
}
