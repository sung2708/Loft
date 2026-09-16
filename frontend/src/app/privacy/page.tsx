import { LegalPage } from "@/components/legal/LegalPage";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Chính sách quyền riêng tư"
      summary="Chính sách này giải thích dữ liệu Mingly xử lý khi bạn đăng nhập, tạo hoặc tham gia phòng, trò chuyện và sử dụng các tính năng trong phòng."
      sections={[
        {
          title: "Dữ liệu Google và mục đích sử dụng",
          content: (
            <>
              <p>Khi bạn chọn Đăng nhập bằng Google, Mingly chỉ nhận thông tin hồ sơ cơ bản mà bạn chấp thuận: tên hiển thị, địa chỉ email và ảnh đại diện.</p>
              <p>Thông tin này chỉ được dùng để tạo hoặc đăng nhập tài khoản, nhận diện bạn trong ứng dụng và hiển thị hồ sơ của bạn cho những người cùng phòng khi cần thiết.</p>
              <p>Mingly không bán, cho thuê hoặc dùng dữ liệu Google của bạn cho quảng cáo. Chúng tôi không chia sẻ dữ liệu này với bên thứ ba, trừ các nhà cung cấp cần thiết để vận hành dịch vụ như đã nêu bên dưới hoặc khi pháp luật yêu cầu.</p>
              <p>Bạn có thể đăng xuất khỏi Mingly bất cứ lúc nào và thu hồi quyền truy cập của Mingly trong phần Bảo mật của Tài khoản Google.</p>
            </>
          ),
        },
        {
          title: "Dữ liệu khi sử dụng phòng",
          content: (
            <>
              <p>Khi dùng phòng, chúng tôi xử lý tên phòng, cài đặt quyền truy cập, thành viên hiện diện, tin nhắn, trạng thái phát nội dung và các thao tác quản trị cần thiết để phòng hoạt động.</p>
            </>
          ),
        },
        {
          title: "Âm thanh, video và chia sẻ màn hình",
          content: (
            <>
              <p>Âm thanh, video và chia sẻ màn hình được truyền trực tiếp qua LiveKit để phục vụ cuộc gọi. Mingly không cung cấp tính năng ghi hình phòng.</p>
              <p>Quyền dùng micro, camera hoặc chia sẻ màn hình luôn do trình duyệt của bạn quản lý và có thể tắt bất cứ lúc nào.</p>
            </>
          ),
        },
        {
          title: "Dịch vụ bên thứ ba",
          content: (
            <p>Mingly sử dụng Supabase cho xác thực và cơ sở dữ liệu, Google cho đăng nhập, LiveKit cho truyền thông thời gian thực và YouTube khi bạn chủ động thêm nội dung từ YouTube.</p>
          ),
        },
        {
          title: "Lưu giữ và bảo vệ dữ liệu",
          content: (
            <p>Dữ liệu phòng và tin nhắn được lưu trong thời gian cần thiết để vận hành dịch vụ. Chúng tôi áp dụng kiểm soát quyền truy cập ở máy chủ; không hiển thị mật khẩu phòng, token đăng nhập hoặc khóa dịch vụ cho người dùng khác.</p>
          ),
        },
        {
          title: "Thay đổi chính sách",
          content: (
            <p>Khi chính sách thay đổi, ngày cập nhật ở đầu trang sẽ được điều chỉnh. Việc tiếp tục sử dụng Mingly sau thay đổi đồng nghĩa bạn đã xem chính sách mới.</p>
          ),
        },
      ]}
    />
  );
}
