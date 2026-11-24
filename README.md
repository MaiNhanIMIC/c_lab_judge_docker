# C-Lab Judge — Hướng Dẫn Cài Đặt & Triển Khai Trên Ubuntu Server (Docker + Nginx)

Tài liệu này hướng dẫn chi tiết cách cài đặt môi trường từ đầu trên **Ubuntu Server (22.04 / 24.04 LTS)** để chạy hệ thống **C-Lab Judge** (chấm điểm C/C++ bằng `gcc`/`g++` thật qua Docker) và cấu hình **Nginx** làm Reverse Proxy (hỗ trợ cả truy cập bằng IP lẫn tên miền có HTTPS).

## 1. Yêu cầu hệ thống

* **Hệ điều hành:** Ubuntu 20.04 / 22.04 / 24.04 LTS

* **Cấu hình tối thiểu:** 1 vCPU, 1 GB RAM, 10 GB ổ cứng trống

* **Quyền truy cập:** Tài khoản `root` hoặc user có quyền `sudo`

## 2. Cập nhật hệ thống & Cài đặt Docker

Đăng nhập SSH vào server Ubuntu và chạy các lệnh sau:

```
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg unzip

```

Cài đặt **Docker Engine** và **Docker Compose Plugin**:

```
# Thêm GPG key và repository chính thức của Docker
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

```

Kiểm tra Docker đã chạy thành công:

```
sudo docker --version
sudo docker compose version

```

*(Tùy chọn)* Cho phép user hiện tại chạy `docker` không cần `sudo`:

```
sudo usermod -aG docker $USER
newgrp docker

```

## 3. Tải mã nguồn & Khởi chạy C-Lab Judge bằng Docker

1. Tạo thư mục ứng dụng và giải nén file `c_lab_judge_docker.zip` lên server:

```
sudo mkdir -p /opt/c-lab-judge
sudo chown -R $USER:$USER /opt/c-lab-judge
cd /opt/c-lab-judge

# Nếu đã upload file c_lab_judge_docker.zip vào /opt/c-lab-judge:
unzip c_lab_judge_docker.zip
cd c_lab_judge_docker

```

2. Build image và khởi chạy container chạy nền:

```
docker compose up -d --build

```

3. Kiểm tra trạng thái container và API:

```
docker compose ps
curl http://127.0.0.1:3000/api/health

```

Nếu thấy kết quả `{"ok":true,"compiler":"gcc/g++","problemsLoaded":540}` là backend Docker đã hoạt động bình thường.

## 4. Cài đặt & Cấu hình Nginx Reverse Proxy

Cài đặt Nginx:

```
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

```

Tạo file cấu hình site cho C-Lab Judge:

```
sudo nano /etc/nginx/sites-available/c-lab-judge

```

Dán nội dung cấu hình sau (thay `your-domain.com` bằng tên miền của bạn, hoặc giữ `_` nếu truy cập trực tiếp qua IP server):

```
server {
    listen 80;
    server_name your-domain.com _;

    client_max_body_size 5M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Tăng timeout để chờ GCC/G++ biên dịch các bài tập lớn
        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
}

```

Kích hoạt cấu hình và kiểm tra lỗi cú pháp Nginx:

```
sudo ln -sf /etc/nginx/sites-available/c-lab-judge /etc/nginx/sites-enabled/c-lab-judge
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

```

## 5. Mở tường lửa (UFW)

Cho phép SSH (22), HTTP (80) và HTTPS (443):

```
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status

```

*(Lưu ý: Không cần mở port `3000` ra ngoài internet vì mọi truy cập đã đi qua Nginx ở port `80`/`443`.)*

## 6. Cài đặt HTTPS miễn phí với Certbot (Nếu có tên miền)

Nếu bạn đã trỏ tên miền `your-domain.com` về IP của server Ubuntu, chạy lệnh sau để cấp chứng chỉ SSL miễn phí từ Let's Encrypt:

```
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com

```

Kiểm tra tự động gia hạn SSL:

```
sudo certbot renew --dry-run

```

## 7. Các lệnh quản trị & Bảo trì thường dùng

* **Xem log của server chấm bài:**

  ```
  cd /opt/c-lab-judge/c_lab_judge_docker
  docker compose logs -f
  
  ```

* **Khởi động lại sau khi cập nhật đề bài JSON (`public/data/buoi_*.json`):**

  ```
  docker compose restart
  
  ```

* **Build lại sau khi sửa `server.js` hoặc `public/index.html`:**

  ```
  docker compose up -d --build
  
  ```

* **Sao lưu dữ liệu lớp học, học sinh & lịch sử nộp bài:**
  Toàn bộ dữ liệu được lưu bền vững tại `/opt/c-lab-judge/c_lab_judge_docker/storage/db.json`. Bạn chỉ cần copy file này để backup.