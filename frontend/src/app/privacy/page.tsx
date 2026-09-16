import { LegalPage, type LegalPageCopies } from "@/components/legal/LegalPage";

const copies: LegalPageCopies = {
  vi: {
    title: "Chính sách quyền riêng tư",
    summary: "Chính sách này giải thích dữ liệu Mingly xử lý khi bạn đăng nhập, tạo hoặc tham gia phòng, trò chuyện và sử dụng các tính năng trong phòng.",
    backLabel: "Về trang chính",
    updatedLabel: "Cập nhật lần cuối",
    sections: [
      { title: "Dữ liệu Google và mục đích sử dụng", paragraphs: ["Khi bạn chọn Đăng nhập bằng Google, Mingly chỉ nhận thông tin hồ sơ cơ bản mà bạn chấp thuận: tên hiển thị, địa chỉ email và ảnh đại diện.", "Thông tin này chỉ được dùng để tạo hoặc đăng nhập tài khoản, nhận diện bạn trong ứng dụng và hiển thị hồ sơ của bạn cho những người cùng phòng khi cần thiết.", "Mingly không bán, cho thuê hoặc dùng dữ liệu Google của bạn cho quảng cáo. Chúng tôi không chia sẻ dữ liệu này với bên thứ ba, trừ các nhà cung cấp cần thiết để vận hành dịch vụ như đã nêu bên dưới hoặc khi pháp luật yêu cầu.", "Bạn có thể đăng xuất khỏi Mingly bất cứ lúc nào và thu hồi quyền truy cập của Mingly trong phần Bảo mật của Tài khoản Google."] },
      { title: "Dữ liệu khi sử dụng phòng", paragraphs: ["Khi dùng phòng, chúng tôi xử lý tên phòng, cài đặt quyền truy cập, thành viên hiện diện, tin nhắn, trạng thái phát nội dung và các thao tác quản trị cần thiết để phòng hoạt động."] },
      { title: "Âm thanh, video và chia sẻ màn hình", paragraphs: ["Âm thanh, video và chia sẻ màn hình được truyền trực tiếp qua LiveKit để phục vụ cuộc gọi. Mingly không cung cấp tính năng ghi hình phòng.", "Quyền dùng micro, camera hoặc chia sẻ màn hình luôn do trình duyệt của bạn quản lý và có thể tắt bất cứ lúc nào."] },
      { title: "Dịch vụ bên thứ ba", paragraphs: ["Mingly sử dụng Supabase cho xác thực và cơ sở dữ liệu, Google cho đăng nhập, LiveKit cho truyền thông thời gian thực và YouTube khi bạn chủ động thêm nội dung từ YouTube."] },
      { title: "Lưu giữ và bảo vệ dữ liệu", paragraphs: ["Dữ liệu phòng và tin nhắn được lưu trong thời gian cần thiết để vận hành dịch vụ. Chúng tôi áp dụng kiểm soát quyền truy cập ở máy chủ; không hiển thị mật khẩu phòng, token đăng nhập hoặc khóa dịch vụ cho người dùng khác."] },
      { title: "Thay đổi chính sách", paragraphs: ["Khi chính sách thay đổi, ngày cập nhật ở đầu trang sẽ được điều chỉnh. Việc tiếp tục sử dụng Mingly sau thay đổi đồng nghĩa bạn đã xem chính sách mới."] },
    ],
  },
  en: {
    title: "Privacy Policy",
    summary: "This policy explains the data Mingly processes when you sign in, create or join a room, chat, and use room features.",
    backLabel: "Back to home",
    updatedLabel: "Last updated",
    sections: [
      { title: "Google data and how we use it", paragraphs: ["When you choose Sign in with Google, Mingly receives only the basic profile information you approve: your display name, email address, and profile picture.", "We use this information only to create or sign you in to your account, identify you in the app, and show your profile to people in the same room when needed.", "Mingly does not sell, rent, or use your Google data for advertising. We do not share it with third parties except the service providers needed to operate Mingly, described below, or where required by law.", "You can sign out of Mingly at any time and revoke Mingly's access from the Security section of your Google Account."] },
      { title: "Room usage data", paragraphs: ["When you use a room, we process the room name, access settings, participant presence, messages, shared media state, and moderation actions needed to operate the room."] },
      { title: "Audio, video, and screen sharing", paragraphs: ["Audio, video, and screen sharing are transmitted through LiveKit to provide calls. Mingly does not provide room recording.", "Your browser controls access to your microphone, camera, and screen. You can disable any of these permissions at any time."] },
      { title: "Third-party services", paragraphs: ["Mingly uses Supabase for authentication and data storage, Google for sign-in, LiveKit for real-time media, and YouTube only when you choose to add YouTube content."] },
      { title: "Data retention and protection", paragraphs: ["We retain room data and messages for as long as needed to operate the service. We enforce server-side access controls and do not expose room passwords, sign-in tokens, or service keys to other users."] },
      { title: "Policy changes", paragraphs: ["When this policy changes, we will update the date at the top of this page. Continued use of Mingly after a change means you have reviewed the updated policy."] },
    ],
  },
};

export default function PrivacyPage() {
  return <LegalPage copies={copies} />;
}
