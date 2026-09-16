import { LegalPage } from "@/components/legal/LegalPage";

export default function TermsPage() {
  return (
    <LegalPage
      title="Điều khoản sử dụng"
      summary="Các điều khoản này quy định cách sử dụng Mingly, một không gian để tạo phòng, trò chuyện và chia sẻ nội dung với những người bạn mời."
      languageHref="/terms/en"
      languageLabel="English"
      backLabel="Về trang chính"
      updatedLabel="Cập nhật lần cuối"
      sections={[
        {
          title: "Sử dụng dịch vụ",
          content: (
            <p>Bạn chỉ sử dụng Mingly cho mục đích hợp pháp, tôn trọng người khác và tuân thủ điều khoản của các dịch vụ liên kết như Google, YouTube và LiveKit.</p>
          ),
        },
        {
          title: "Phòng và quyền quản trị",
          content: (
            <p>Chủ phòng chịu trách nhiệm về người được mời, cài đặt khách, mật khẩu, khóa phòng và các thao tác quản trị. Chủ phòng có thể mời, xóa hoặc chặn thành viên theo quyền được cấp trong ứng dụng.</p>
          ),
        },
        {
          title: "Nội dung và hành vi bị cấm",
          content: (
            <p>Không dùng Mingly để quấy rối, lừa đảo, xâm phạm quyền riêng tư, phát tán nội dung bất hợp pháp hoặc cố gắng truy cập trái phép vào phòng, tài khoản hay hệ thống.</p>
          ),
        },
        {
          title: "Dịch vụ bên thứ ba",
          content: (
            <p>Một số tính năng phụ thuộc vào dịch vụ bên thứ ba. Việc các dịch vụ này gián đoạn, thay đổi hoặc từ chối yêu cầu có thể ảnh hưởng đến một phần chức năng của Mingly.</p>
          ),
        },
        {
          title: "Thay đổi dịch vụ",
          content: (
            <p>Mingly có thể cập nhật, giới hạn hoặc ngừng một tính năng để bảo mật, bảo trì hoặc cải thiện dịch vụ. Điều khoản mới sẽ được công bố tại trang này.</p>
          ),
        },
      ]}
    />
  );
}
