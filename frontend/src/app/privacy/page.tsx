import { LegalPage, type LegalPageCopies } from "@/components/legal/LegalPage";

const copies: LegalPageCopies = {
  vi: {
    title: "Chính sách quyền riêng tư",
    summary: "Chính sách này giải thích dữ liệu Mingly xử lý, lý do xử lý, ai có thể thấy dữ liệu và các lựa chọn bạn có khi dùng phòng.",
    backLabel: "Về trang chính",
    updatedLabel: "Cập nhật lần cuối",
    notice: "Mingly không ghi hình phòng. Bạn kiểm soát micro, camera, chia sẻ màn hình và các kết nối dịch vụ bên thứ ba từ trình duyệt hoặc phần cài đặt tài khoản.",
    sections: [
      { title: "Dữ liệu Google và mục đích sử dụng", paragraphs: ["Khi bạn chọn Đăng nhập bằng Google, Mingly chỉ nhận thông tin hồ sơ cơ bản mà bạn chấp thuận: tên hiển thị, địa chỉ email và ảnh đại diện.", "Thông tin này chỉ được dùng để tạo hoặc đăng nhập tài khoản, nhận diện bạn trong ứng dụng và hiển thị hồ sơ của bạn cho những người cùng phòng khi cần thiết.", "Mingly không bán, cho thuê hoặc dùng dữ liệu Google của bạn cho quảng cáo. Chúng tôi không chia sẻ dữ liệu này với bên thứ ba, trừ các nhà cung cấp cần thiết để vận hành dịch vụ như đã nêu bên dưới hoặc khi pháp luật yêu cầu.", "Bạn có thể đăng xuất khỏi Mingly bất cứ lúc nào và thu hồi quyền truy cập của Mingly trong phần Bảo mật của Tài khoản Google."] },
      { title: "Dữ liệu chúng tôi xử lý", paragraphs: ["Khi dùng phòng, chúng tôi xử lý tên phòng, cài đặt quyền truy cập, thành viên hiện diện, tin nhắn, trạng thái phát nội dung và các thao tác quản trị cần thiết để phòng hoạt động.", "Những người trong cùng phòng có thể thấy tên hiển thị, ảnh đại diện nếu có, trạng thái hiện diện và nội dung bạn chủ động gửi. Chủ phòng có thể thấy và dùng các công cụ quản trị được hiển thị trong ứng dụng."] },
      { title: "Âm thanh, video và chia sẻ màn hình", paragraphs: ["Âm thanh, video và chia sẻ màn hình được truyền trực tiếp qua LiveKit để phục vụ cuộc gọi. Mingly không cung cấp tính năng ghi hình phòng.", "Quyền dùng micro, camera hoặc chia sẻ màn hình luôn do trình duyệt của bạn quản lý và có thể tắt bất cứ lúc nào."] },
      { title: "Dịch vụ bên thứ ba và nội dung nhúng", paragraphs: ["Mingly sử dụng nhà cung cấp xác thực, cơ sở dữ liệu và truyền thông thời gian thực để vận hành dịch vụ. YouTube chỉ được dùng khi bạn chủ động tìm kiếm, thêm hoặc phát nội dung; trình phát nhúng của YouTube có thể áp dụng điều khoản và công nghệ của YouTube.", "Chúng tôi không bán dữ liệu cá nhân, không dùng dữ liệu kết nối Google cho quảng cáo, và không đưa token kết nối của bạn vào phòng hoặc trình duyệt của người khác."] },
      { title: "Lưu giữ, bảo mật và lựa chọn của bạn", paragraphs: ["Dữ liệu phòng và tin nhắn được lưu trong thời gian cần thiết để vận hành, bảo mật và xử lý yêu cầu hợp lệ. Chúng tôi áp dụng kiểm soát quyền truy cập ở máy chủ; không hiển thị mật khẩu phòng, token đăng nhập hoặc khóa dịch vụ cho người dùng khác.", "Bạn có thể rời phòng, tắt quyền thiết bị và thu hồi quyền Google từ tài khoản Google. Để yêu cầu truy cập, chỉnh sửa hoặc xóa dữ liệu tài khoản, hãy dùng kênh hỗ trợ chính thức được công bố trên Mingly."] },
      { title: "Google API Services", paragraphs: ["Việc Mingly sử dụng và chuyển giao thông tin nhận từ Google API Services tuân theo Google API Services User Data Policy, bao gồm các yêu cầu Limited Use. Mingly chỉ yêu cầu và sử dụng dữ liệu Google cho các tính năng hiển thị rõ trong ứng dụng."] },
      { title: "Thay đổi chính sách", paragraphs: ["Khi chính sách thay đổi, ngày cập nhật ở đầu trang sẽ được điều chỉnh. Việc tiếp tục sử dụng Mingly sau thay đổi đồng nghĩa bạn đã xem chính sách mới."] },
    ],
  },
  en: {
    title: "Privacy Policy",
    summary: "This policy explains what data Mingly processes, why we process it, who can see it, and the choices you have while using rooms.",
    backLabel: "Back to home",
    updatedLabel: "Last updated",
    notice: "Mingly does not record rooms. You control microphone, camera, screen-sharing, and third-party connections through your browser or account settings.",
    sections: [
      { title: "Google data and how we use it", paragraphs: ["When you choose Sign in with Google, Mingly receives only the basic profile information you approve: your display name, email address, and profile picture.", "We use this information only to create or sign you in to your account, identify you in the app, and show your profile to people in the same room when needed.", "Mingly does not sell, rent, or use your Google data for advertising. We do not share it with third parties except the service providers needed to operate Mingly, described below, or where required by law.", "You can sign out of Mingly at any time and revoke Mingly's access from the Security section of your Google Account."] },
      { title: "Data we process", paragraphs: ["When you use a room, we process the room name, access settings, participant presence, messages, shared media state, and moderation actions needed to operate the room.", "People in the same room can see your display name, profile image when available, presence, and content you intentionally send. Room hosts can use the moderation tools shown in the app."] },
      { title: "Audio, video, and screen sharing", paragraphs: ["Audio, video, and screen sharing are transmitted through LiveKit to provide calls. Mingly does not provide room recording.", "Your browser controls access to your microphone, camera, and screen. You can disable any of these permissions at any time."] },
      { title: "Third-party services and embedded content", paragraphs: ["Mingly uses authentication, storage, and real-time communications providers to operate the service. YouTube is used only when you choose to search, add, or play content; its embedded player may apply YouTube terms and technologies.", "We do not sell personal data, use connected Google data for advertising, or expose connection tokens to people in your room or their browsers."] },
      { title: "Retention, security, and your choices", paragraphs: ["We retain room data and messages for as long as needed to operate, secure, and address legitimate requests. We enforce server-side access controls and do not expose room passwords, sign-in tokens, or service keys to other users.", "You can leave a room, disable device permissions, and revoke Google access from your Google Account. To request access, correction, or deletion of account data, use the official support channel published on Mingly."] },
      { title: "Google API Services", paragraphs: ["Mingly's use and transfer of information received from Google API Services adheres to the Google API Services User Data Policy, including the Limited Use requirements. We request and use Google data only for prominent user-facing features in the app."] },
      { title: "Policy changes", paragraphs: ["When this policy changes, we will update the date at the top of this page. Continued use of Mingly after a change means you have reviewed the updated policy."] },
    ],
  },
};

export default function PrivacyPage() {
  return <LegalPage copies={copies} />;
}
