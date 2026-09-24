export default function NotFound() {
  return (
    <div className="card notice" style={{ marginTop: 24 }}>
      <h1>ไม่พบหน้านี้</h1>
      <p>ลิงก์อาจเก่าหรือพิมพ์ผิด</p>
      <a className="btn btn-primary" href="/">กลับหน้าหลัก</a>
    </div>
  );
}
